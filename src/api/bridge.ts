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
 * 云 API 调用由云端 MCP 服务（Lighthouse Agent）代办：curated 工具映射到
 * 云端工具名（describe_instances，参数为 PascalCase 的 InstanceIds）；
 * 其余云端工具经 callCloudTool 动态调用（tools/list 为准）。云端可用工具
 * 清单由服务端定义；若服务端调整工具名，以 tools/list 返回为准。
 */
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  AuthFlowPoll,
  AuthFlowStart,
  AuthStatus,
  BridgeConfig,
  CloudToolSummary,
  InstanceListResult,
  InstanceSummary,
  LighthouseApi,
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

// ── 远端工具名映射（curated 工具对应的云端工具名；其余工具经 callCloudTool 动态调用）──

const TOOL_LIST = 'describe_instances'

/**
 * 主流地域（并行查询的默认范围，参考 WorkBuddy skill 的常见地域表）。
 * 完整地域列表以 describe_regions 为准；用户实例不在以下地域时，可指定地域精确查询。
 */
const MAINSTREAM_REGIONS = [
  'ap-beijing',    // 北京
  'ap-shanghai',   // 上海
  'ap-guangzhou',  // 广州
  'ap-chengdu',    // 成都
  'ap-nanjing',    // 南京
  'ap-hongkong',   // 香港
]

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

  /** 调 MCP JSON-RPC tools/list（需有效 access_token），返回云端放行的工具数组 */
  async function mcpListTools(accessToken: string): Promise<any[]> {
    const { status, body } = await fetchJson(`${base}/workbuddy/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcSeq, method: 'tools/list', params: {} }),
    })
    if (status === 401) throw new UnauthorizedError()
    if (!body || body.error) {
      throw new Error(body?.error?.message || `tools/list failed: HTTP ${status}`)
    }
    return body.result?.tools ?? []
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

  /** 调工具并处理 401：刷新一次后重试，仍失败则要求重新授权。统一注入 Region（云端工具必填参数） */
  async function callToolWithAuthRetry(name: string, args: Record<string, unknown>): Promise<any> {
    const withRegion = { Region: config.region, ...args }
    const tokens = await readTokens()
    if (!tokens) throw new NeedReauthError()
    try {
      return await mcpCallTool(tokens.access_token, name, withRegion)
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

    async listInstances(regionOverride?: string): Promise<InstanceListResult> {
      // 多地域并行查询（云端 describe_instances 必填 Region，单地域会漏实例）：
      // 未指定地域时并行查主流 6 地域 + 配置的首选地域（去重）；指定则精确查单地域。
      // 分页：每地域单页 Limit=100（远端返回 Markdown 无 TotalCount 字段，无法翻页校验；
      //       个人用户单地域 100 台以内的场景足够，超大账号需云端返回结构化数据支持）。
      const regions = regionOverride
        ? [regionOverride]
        : [...new Set([...MAINSTREAM_REGIONS, config.region])]
      const results = await Promise.allSettled(
        regions.map((r) => callToolWithAuthRetry(TOOL_LIST, { Region: r, Offset: 0, Limit: 100 })),
      )
      const parts: string[] = []
      const instances: InstanceSummary[] = []
      const queried: string[] = []
      regions.forEach((r, i) => {
        const res = results[i]
        if (res.status !== 'fulfilled') return // 单地域失败不阻塞其余地域
        const err = extractToolError(res.value)
        if (err) return
        const markdown = extractMcpText(res.value).trim()
        if (!markdown || /^暂无数据/.test(markdown)) return
        const parsed = parseInstancesFromMarkdown(markdown)
        if (!parsed.length) return
        queried.push(r)
        parts.push(`### ${r}\n${markdown}`)
        instances.push(...parsed)
      })
      if (!instances.length) {
        return {
          markdown: '',
          instances: [],
          regionsQueried: queried.length ? queried : regions,
          note: regions.length > 1
            ? `已并行查询 ${regions.length} 个主流地域（${regions.join('、')}），未发现实例。` +
              `若你的实例在其他地域（东京/新加坡/首尔/硅谷/法兰克福等），请指定具体地域重新查询。`
            : `地域 ${regions[0]} 未发现实例。`,
        }
      }
      return {
        markdown: parts.join('\n\n'),
        instances,
        regionsQueried: queried,
        note: regions.length > 1
          ? `已并行查询 ${regions.length} 个主流地域，命中 ${queried.length} 个（${queried.join('、')}）。` +
            `若你的实例在其他地域未被列出，请指定具体地域重新查询。`
          : '',
      }
    },

    async callCloudTool(name: string, args: Record<string, unknown>): Promise<string> {
      const result = await callToolWithAuthRetry(name, args)
      const err = extractToolError(result)
      if (err) throw new Error(`云端工具 ${name} 执行失败：${err}`)
      return extractMcpText(result)
    },

    async listCloudTools(): Promise<CloudToolSummary[]> {
      async function listWith(accessToken: string): Promise<CloudToolSummary[]> {
        const tools = await mcpListTools(accessToken)
        return tools.map((t: any) => ({
          name: String(t?.name ?? ''),
          displayName: String(t?._meta?.name ?? ''),
          description: String(t?.description ?? ''),
          requiredParams: (t?.inputSchema?.required ?? []).map(String),
          interactionType: String(t?._meta?.interactionType ?? 'auto'),
          inputSchema: (t?.inputSchema ?? {}) as Record<string, unknown>,
        }))
      }
      const tokens = await readTokens()
      if (!tokens) throw new NeedReauthError()
      try {
        return await listWith(tokens.access_token)
      } catch (err) {
        if (!(err instanceof UnauthorizedError)) throw err
        const refreshed = await tryRefresh()
        if (!refreshed) throw new NeedReauthError()
        const next = await readTokens()
        return listWith(next!.access_token)
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


function normalizeState(raw: unknown): InstanceSummary['state'] {
  const s = String(raw || '').toUpperCase()
  if (s === 'RUNNING' || s === 'STOPPED' || s === 'STARTING' || s === 'STOPPING' || s === 'REBOOTING') return s
  // 未知状态（如 SHUTDOWN 隔离/FREEZING 冻结/RESCUE_MODE 救援）原样保留，不猜测为运行中
  return (s || 'UNKNOWN') as InstanceSummary['state']
}

function extractRequestId(result: any): string {
  const payload = extractMcpPayload(result)
  return String(payload?.Response?.RequestId ?? payload?.RequestId ?? '')
}

/** 检测 MCP tools/call 结果是否携带业务错误（MCP isError 标记或 TC API Error 结构） */
function extractToolError(result: any): string | null {
  if (result?.isError === true) {
    const text = result?.content?.find?.((c: any) => c?.type === 'text')?.text
    if (typeof text === 'string' && text) return text
  }
  const payload = extractMcpPayload(result)
  const err = payload?.Response?.Error ?? payload?.Error
  if (err && typeof err === 'object') {
    return [err.Code, err.Message].filter(Boolean).join(' ') || JSON.stringify(err)
  }
  return null
}

/** 提取 tools/call 结果的首段 text 原文（远端 Agent 返回 Markdown 表格，供 LLM 直接阅读） */
function extractMcpText(result: any): string {
  const text = result?.content?.find?.((c: any) => c?.type === 'text')?.text
  return typeof text === 'string' ? text : ''
}

/**
 * 从远端 Agent 的 Markdown 表格解析实例（远端为 LLM 优化的输出是 Markdown 而非 JSON）。
 * 按表头列名建映射后逐行提取，列顺序变化不影响；无法解析的行跳过。
 */
function parseInstancesFromMarkdown(md: string): InstanceSummary[] {
  const lines = md.split('\n').filter((l) => l.trim().startsWith('|'))
  if (lines.length < 3) return []
  const header = lines[0].split('|').map((s) => s.trim())
  const idx = (name: string): number =>
    header.findIndex((h) => h.toLowerCase().replace(/\s+/g, '') === name.toLowerCase())
  const iId = idx('instanceid')
  const iName = idx('instancename')
  const iState = idx('instancestate')
  const iCpu = idx('cpu')
  const iMem = idx('memory')
  const iZone = idx('zone')
  const iPub = idx('publicaddresses')
  const iPriv = idx('privateaddresses')
  const iCreated = idx('createdtime')
  if (iId < 0) return []
  const out: InstanceSummary[] = []
  for (const line of lines.slice(2)) {
    const cells = line.split('|').map((s) => s.trim())
    const id = cells[iId] ?? ''
    if (!id.startsWith('lhins-')) continue
    const val = (i: number): string => (i >= 0 && cells[i] && cells[i] !== '-' ? cells[i] : '')
    out.push({
      instanceId: id,
      instanceName: val(iName) || id,
      publicIp: val(iPub),
      privateIp: val(iPriv),
      zone: val(iZone),
      state: normalizeState(val(iState)),
      cpu: Number(val(iCpu)) || 0,
      memory: Number(val(iMem)) || 0,
      createdAt: val(iCreated),
    })
  }
  return out
}
