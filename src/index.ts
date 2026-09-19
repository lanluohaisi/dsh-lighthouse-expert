/**
 * 轻量云专家 —— host 侧入口。
 *
 * 结构：Config Schema + ctx.tools.register x3 + webServer 路由 + settings 命名空间
 *
 * 安全设计：所有工具 execute 前检查授权状态，未授权返回引导文案，绝不发起云 API 调用。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'
import { createBridgeBackend } from './api/bridge.js'
import { createMockBackend } from './api/mock.js'
import type { AuthStatus, InstanceSummary, LighthouseApi, OperationResult } from './api/types.js'
import { handleLighthouseApi } from './local-api.js'

export const name = 'lighthouse-expert'
export const inject = ['tools']

export interface Config {
  backend: 'mock' | 'bridge'
  apiBase: string
  timeoutMs: number
}

export const Config: Schema<Config> = Schema.object({
  backend: Schema.union(['mock', 'bridge'] as const)
    .default('bridge')
    .description('后端实现：bridge=真实链路（默认，走腾讯云轻量应用服务器 OAuth 授权）；mock=内置演示数据（开发调试用）'),
  apiBase: Schema.string()
    .default('https://lightai.cloud.tencent.com')
    .description('bridge 模式的后端地址（Lighthouse Agent 云端服务）'),
  timeoutMs: Schema.number().default(20000).description('请求超时（毫秒）'),
})

export function apply(ctx: Context, config: Config): void {
  const api: LighthouseApi = config.backend === 'bridge' ? createBridgeBackend(config) : createMockBackend()

  /** 未授权统一返回引导文案，不执行任何云 API 调用 */
  const unauthorized = (status: AuthStatus) => ({
    isError: true,
    authStatus: status,
    message:
      status === 'expired'
        ? '腾讯云授权已过期。请点击左侧「轻量云专家」入口，按面板引导重新授权后再试。'
        : '尚未完成腾讯云授权。请点击左侧「轻量云专家」入口，按面板引导完成授权后再试。',
  })

  // ---- 工具 1：实例列表 ----
  ctx.tools.register(defineTool({
    name: 'lighthouse_list_instances',
    description:
      "List the user's Tencent Cloud Lighthouse (轻量应用服务器) instances: name, public IP, state (运行中/已关机), zone and specs. ALWAYS call this when the user asks about their cloud servers (我的服务器 / 实例列表 / 哪些在跑 / 机器状态). One call per user message. If the result says not authorized, tell the user to open the 轻量云专家 panel in the left sidebar.",
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [
        { type: 'text', text: renderInstances(value as unknown as InstancesPayload) },
      ],
      presentationMeta: (_args, value) => ({ kind: 'lighthouse-instances', ...(value as object) }),
    },
    presentCall: () => ({ card: 'generic', title: '轻量云 · 查询实例', kind: 'read', content: [] }),
    presentResult: (_args, { isError }) => ({
      card: 'generic',
      title: isError ? '轻量云 · 未授权' : '轻量云 · 实例列表',
      content: [],
    }),
    timeoutMs: config.timeoutMs,
    async execute() {
      const auth = await api.getAuthStatus()
      if (auth !== 'authorized') return unauthorized(auth)
      return cloneJson({ instances: await api.listInstances() })
    },
  }))

  // ---- 工具 2：单实例详情 ----
  ctx.tools.register(defineTool({
    name: 'lighthouse_describe_instance',
    description:
      'Describe one Tencent Cloud Lighthouse instance by its instanceId (e.g. lhins-xxxxxxxx). Use after lighthouse_list_instances when the user wants details of a specific server. Returns name, IPs, zone, state and specs.',
    parameters: {
      instanceId: {
        type: 'string',
        required: true,
        description: 'Instance ID from the list result, e.g. lhins-mock0001',
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [
        { type: 'text', text: renderInstances(value as unknown as InstancesPayload) },
      ],
      presentationMeta: (_args, value) => ({ kind: 'lighthouse-instances', ...(value as object) }),
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `轻量云 · 详情 ${String(args.instanceId ?? '')}`,
      kind: 'read',
      content: [],
    }),
    presentResult: (_args, { isError }) => ({
      card: 'generic',
      title: isError ? '轻量云 · 查询失败' : '轻量云 · 实例详情',
      content: [],
    }),
    timeoutMs: config.timeoutMs,
    async execute(args) {
      const auth = await api.getAuthStatus()
      if (auth !== 'authorized') return unauthorized(auth)
      const instance = await api.describeInstance(String(args.instanceId || ''))
      if (!instance) return { isError: true, message: `未找到实例 ${String(args.instanceId)}` }
      return cloneJson({ instances: [instance] })
    },
  }))

  // ---- 工具 3：重启实例（高危，走 DSH 审批） ----
  ctx.tools.register(defineTool({
    name: 'lighthouse_reboot_instances',
    description:
      'Reboot Tencent Cloud Lighthouse instances. DANGEROUS operation: only call after the user explicitly names the target server(s) and confirms. DSH approval flow will ask the user again. Pass instanceIds from lighthouse_list_instances.',
    parameters: {
      instanceIds: {
        type: 'array',
        items: { type: 'string' },
        required: true,
        description: 'Instance IDs to reboot, e.g. ["lhins-mock0001"]',
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [
        { type: 'text', text: renderReboot(value as unknown as RebootPayload) },
      ],
      presentationMeta: (_args, value) => ({ kind: 'lighthouse-reboot', ...(value as object) }),
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `轻量云 · 重启 ${(args.instanceIds as string[] | undefined)?.length ?? 0} 台`,
      kind: 'execute',
      content: [],
    }),
    presentResult: (_args, { isError }) => ({
      card: 'generic',
      title: isError ? '轻量云 · 操作未执行' : '轻量云 · 重启已下发',
      content: [],
    }),
    timeoutMs: config.timeoutMs + 15000,
    async execute(args) {
      const auth = await api.getAuthStatus()
      if (auth !== 'authorized') return unauthorized(auth)
      const ids = Array.isArray(args.instanceIds) ? args.instanceIds.map(String) : []
      if (!ids.length) return { isError: true, message: 'instanceIds 不能为空' }
      return cloneJson(await api.rebootInstances(ids))
    },
  }))

  // ---- 给面板的本地 HTTP 路由（client fetch 同源调用）----
  ctx.inject(['webServer'], (c) => {
    const server = (c as unknown as {
      webServer: {
        register: (route: {
          kind: string
          path: string
          handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
        }) => void
      }
    }).webServer
    server.register({
      kind: 'exact',
      path: '/lighthouse',
      handler: (req, res) => handleLighthouseApi(req, res, api),
    })
  })

  // ---- 设置命名空间（client 的 settings.plugin.item 卡片依赖此注册才会 dispatch）----
  ctx.inject(['settings'], (c) => {
    const settings = (c as unknown as {
      settings: {
        register: (ns: string, schema: typeof Config, options?: { base?: Config }) => void
      }
    }).settings
    settings.register('lighthouse', Config, { base: config })
  })

  // ---- 系统提示：引导 Agent 正确使用这组工具 ----
  ctx.inject(['systemPrompt'], (c) => {
    const prompt = (c as unknown as {
      systemPrompt: {
        section: (section: { name: string; order: number; text: string | (() => string) }) => void
      }
    }).systemPrompt
    prompt.section({
      name: 'tool:lighthouse',
      order: 210,
      text: [
        'Tencent Cloud Lighthouse (轻量应用服务器) questions: use lighthouse_list_instances for lists/status, lighthouse_describe_instance for one server, lighthouse_reboot_instances ONLY after explicit user confirmation (dangerous).',
        'If a tool returns 未授权/not authorized, tell the user to open the 轻量云专家 panel in the left sidebar and authorize, then retry. Never fabricate instance data.',
      ].join(' '),
    })
  })
}

// ---- 渲染辅助（对话里的纯文本形态；卡片形态由 client 的 toolview 负责）----

interface InstancesPayload {
  instances?: InstanceSummary[]
  isError?: boolean
  message?: string
}

interface RebootPayload {
  isError?: boolean
  success?: boolean
  message?: string
  requestId?: string
}

function renderInstances(value: InstancesPayload): string {
  if (value.isError) return value.message ?? '请求失败'
  const items = value.instances ?? []
  if (!items.length) return '当前账号下没有轻量应用服务器实例。对用户只说一句：没有查到实例。'
  const lines = items.map(
    (it, i) => `${i + 1}. ${it.instanceName || it.instanceId}（instanceId: ${it.instanceId}） · ${it.publicIp} · ${it.state} · ${it.cpu}C${it.memory}G · ${it.zone}`,
  )
  return [
    `卡片已展示 ${items.length} 台实例（内部序号，禁止复述给用户）：`,
    lines.join('\n'),
    '对用户最多回一句短话。禁止清单和长文。',
  ].join('\n')
}

function renderReboot(value: RebootPayload): string {
  if (value.isError) return value.message ?? '请求失败'
  return value.success
    ? `✅ ${value.message}。请提醒用户重启约需 1 分钟生效。`
    : `❌ 重启失败：${value.message}`
}

function cloneJson(value: unknown) {
  return JSON.parse(JSON.stringify(value))
}
