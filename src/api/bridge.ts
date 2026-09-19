/**
 * BridgeBackend —— 真实云端服务实现（OAuth 轮询授权模式）。
 *
 * 授权链路：POST /workbuddy/oauth/dsh/start → 轮询 GET dsh/status → 令牌落地本机
 * 调用链路：POST /workbuddy/mcp（JSON-RPC tools/call，Bearer access_token）
 * 刷新链路：POST /workbuddy/oauth/token（grant_type=refresh_token，RFC 6749 form 编码）
 *
 * 令牌存储：$DSH_HOME/lighthouse-expert/tokens.json（权限 0600）。
 * access_token 约 2h 有效；refresh_token 约 60 天（过期后需重新授权）。
 * 云端不存储任何长期令牌，令牌仅保存在用户本机。
 *
 * 云 API 调用由云端 MCP 服务（Lighthouse Agent）代办：插件将本插件的工具
 * 映射到云端工具名（describe_instances / reboot_instances，参数为 PascalCase 的
 * InstanceIds）。云端可用工具清单由服务端定义；若服务端调整工具名，以
 * tools/list 返回为准（可动态适配，见 callToolWithAuthRetry 的调用约定）。
 */
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  AuthFlowPoll,
  AuthFlowStart,
  AuthStatus,
  BridgeConfig,
  InstanceSummary,
  LighthouseApi,
  OperationResult,
} from './types.js'

// ── 令牌存储 ──────────────────────────────────────────────

interface StoredTokens {
  access_token: string
  refresh_token: string
  /** access_token 过期时间（ms epoch） */
  expires_at: number
  scope: string
}

function tokensFilePath(): string {
  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(dshHome, 'lighthouse-expert', 'tokens.json')
}

async function readTokens(): Promise<StoredTokens | null> {
  try {
    const raw = await fs.readFile(tokensFilePath(), 'utf8')
    const parsed = JSON.parse(raw) as StoredTokens
    return parsed.access_token ? parsed : null
  } catch {
    return null
  }
}

async function writeTokens(tokens: StoredTokens): Promise<void> {
  const file = tokensFilePath()
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(tokens, null, 2), { mode: 0o600 })
}

// ── 内部错误类型 ──────────────────────────────────────────

/** MCP 端点返回 401（token 过期/无效） */
class UnauthorizedError extends Error {
  constructor() {
    super('unauthorized')
  }
}

/** 刷新后仍 401，需要用户重新授权 */
class NeedReauthError extends Error {
  constructor() {
    super('need reauthorization')
  }
}

// ── 远端工具名映射（以 tools/list 实测为准，见方案文档风险项 2）──

const TOOL_LIST = 'describe_instances'
const TOOL_REBOOT = 'reboot_instances'

// ── Backend 实现 ──────────────────────────────────────────

export function createBridgeBackend(config: BridgeConfig): LighthouseApi {
  const base = config.apiBase.replace(/\/+$/, '')
  let rpcSeq = 0

  /** 带超时的 fetch（AbortController） */
  async function fetchJson(url: string, init: RequestInit): Promise<{ status: number; body: any }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), config.timeoutMs)
    try {
      const res = await fetch(url, { ...init, signal: controller.signal })
      let body: any = null
      try {
        body = await res.json()
      } catch {
        body = null
      }
      return { status: res.status, body }
    } finally {
      clearTimeout(timer)
    }
  }

  /** 调 MCP JSON-RPC tools/call（需有效 access_token） */
  async function mcpCallTool(accessToken: string, name: string, args: Record<string, unknown>): Promise<any> {
    const { status, body } = await fetchJson(`${base}/workbuddy/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++rpcSeq,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    })
    if (status === 401) throw new UnauthorizedError()
    if (!body || body.error) {
      throw new Error(body?.error?.message || `mcp call failed: HTTP ${status}`)
    }
    return body.result
  }

  /** 用 refresh_token 换新 access_token（RFC 6749 form 编码）。成功返回 true。 */
  async function tryRefresh(): Promise<boolean> {
    const tokens = await readTokens()
    if (!tokens?.refresh_token) return false
    const { status, body } = await fetchJson(`${base}/workbuddy/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
      }).toString(),
    })
    if (status !== 200 || !body?.access_token) return false
    await writeTokens({
      access_token: body.access_token,
      // 刷新接口不返回新 refresh_token，旧的继续使用
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + Number(body.expires_in || 7200) * 1000,
      scope: body.scope || tokens.scope,
    })
    return true
  }

  /** 调工具并处理 401：刷新一次后重试，仍失败则要求重新授权 */
  async function callToolWithAuthRetry(name: string, args: Record<string, unknown>): Promise<any> {
    const tokens = await readTokens()
    if (!tokens) throw new NeedReauthError()
    try {
      return await mcpCallTool(tokens.access_token, name, args)
    } catch (err) {
      if (!(err instanceof UnauthorizedError)) throw err
      const refreshed = await tryRefresh()
      if (!refreshed) throw new NeedReauthError()
      const next = await readTokens()
      return mcpCallTool(next!.access_token, name, args)
    }
  }

  return {
    async getAuthStatus(): Promise<AuthStatus> {
      const tokens = await readTokens()
      if (!tokens) return 'unauthorized'
      // 提前 60s 视为过期窗口，尝试刷新
      if (tokens.expires_at - Date.now() > 60_000) return 'authorized'
      const refreshed = await tryRefresh()
      return refreshed ? 'authorized' : 'expired'
    },

    async startAuthFlow(): Promise<AuthFlowStart> {
      const { status, body } = await fetchJson(`${base}/workbuddy/oauth/dsh/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (status !== 200 || !body?.flowId || !body?.authorizeUrl) {
        throw new Error(body?.error_description || `dsh/start failed: HTTP ${status}`)
      }
      return { flowId: String(body.flowId), authorizeUrl: String(body.authorizeUrl) }
    },

    async pollAuthFlow(flowId: string): Promise<AuthFlowPoll> {
      if (!flowId) return { status: 'error', message: 'missing flowId' }
      const { status, body } = await fetchJson(
        `${base}/workbuddy/oauth/dsh/status?flowId=${encodeURIComponent(flowId)}`,
        { method: 'GET' },
      )
      if (status !== 200 || !body?.status) {
        return { status: 'error', message: body?.error_description || `dsh/status failed: HTTP ${status}` }
      }
      if (body.status === 'authorized' && body.access_token) {
        // 令牌落地实例本地（不经过浏览器），一次性领取已在服务端删除 flow
        await writeTokens({
          access_token: String(body.access_token),
          refresh_token: String(body.refresh_token || ''),
          expires_at: Date.now() + Number(body.expires_in || 7200) * 1000,
          scope: String(body.scope || 'connectors:mcp'),
        })
        return { status: 'authorized' }
      }
      return { status: body.status, ...(body.message ? { message: String(body.message) } : {}) }
    },

    async listInstances(): Promise<InstanceSummary[]> {
      const result = await callToolWithAuthRetry(TOOL_LIST, {})
      return parseInstances(result)
    },

    async describeInstance(instanceId: string): Promise<InstanceSummary | null> {
      const result = await callToolWithAuthRetry(TOOL_LIST, { InstanceIds: [instanceId] })
      const list = parseInstances(result)
      return list.find((it) => it.instanceId === instanceId) ?? null
    },

    async rebootInstances(instanceIds: string[]): Promise<OperationResult> {
      const result = await callToolWithAuthRetry(TOOL_REBOOT, { InstanceIds: instanceIds })
      const requestId = extractRequestId(result)
      return {
        requestId: requestId || `dsh-${Date.now()}`,
        success: true,
        message: `已向 ${instanceIds.length} 台实例下发重启指令`,
      }
    },
  }
}

// ── MCP 结果解析（防御性：远端结构以实测为准）──────────────

/** 从 MCP tools/call result 中提取 JSON 数据（标准 { content: [{ type:'text', text }] }） */
function extractMcpPayload(result: any): any {
  const text = result?.content?.find?.((c: any) => c?.type === 'text')?.text
  if (typeof text !== 'string') return result
  try {
    return JSON.parse(text)
  } catch {
    return result
  }
}

/** 把远端 DescribeInstances 响应映射为 InstanceSummary[]（字段名 PascalCase → camelCase） */
function parseInstances(result: any): InstanceSummary[] {
  const payload = extractMcpPayload(result)
  const raw: any[] =
    payload?.Response?.InstanceSet || payload?.InstanceSet || payload?.Instances || payload?.Response?.Instances || []
  return raw.map((it: any) => ({
    instanceId: String(it.InstanceId ?? it.instanceId ?? ''),
    instanceName: String(it.InstanceName ?? it.instanceName ?? it.InstanceId ?? ''),
    publicIp: String(it.PublicAddresses?.[0] ?? it.publicIp ?? ''),
    privateIp: String(it.PrivateAddresses?.[0] ?? it.privateIp ?? ''),
    zone: String(it.Zone ?? it.zone ?? ''),
    state: normalizeState(it.InstanceState ?? it.state),
    cpu: Number(it.CPU ?? it.cpu ?? 0),
    memory: Number(it.Memory ?? it.memory ?? 0),
    createdAt: String(it.CreatedTime ?? it.createdTime ?? ''),
  }))
}

function normalizeState(raw: unknown): InstanceSummary['state'] {
  const s = String(raw || '').toUpperCase()
  if (s === 'RUNNING' || s === 'STOPPED' || s === 'STARTING' || s === 'STOPPING' || s === 'REBOOTING') return s
  return 'RUNNING'
}

function extractRequestId(result: any): string {
  const payload = extractMcpPayload(result)
  return String(payload?.Response?.RequestId ?? payload?.RequestId ?? '')
}
