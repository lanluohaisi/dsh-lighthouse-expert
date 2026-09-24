/**
 * 体验轻量云插件 —— host 侧入口。
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
import type { AuthStatus, CloudToolSummary, InstanceSummary, LighthouseApi } from './api/types.js'
import { handleLighthouseApi } from './local-api.js'

export const name = 'lighthouse-expert'
export const inject = ['tools']

export interface Config {
  backend: 'mock' | 'bridge'
  apiBase: string
  timeoutMs: number
  region: string
}

export const Config: Schema<Config> = Schema.object({
  backend: Schema.union(['mock', 'bridge'] as const)
    .default('bridge')
    .description('后端实现：bridge=真实链路（默认，走腾讯云轻量应用服务器 OAuth 授权）；mock=内置演示数据（开发调试用）'),
  apiBase: Schema.string()
    .default('https://lightai.cloud.tencent.com')
    .description('bridge 模式的后端地址（Lighthouse Agent 云端服务）'),
  timeoutMs: Schema.number().default(20000).description('请求超时（毫秒）'),
  region: Schema.string()
    .default('ap-guangzhou')
    .description('腾讯云地域（云端 MCP 工具必填参数），如 ap-guangzhou / ap-beijing / ap-shanghai'),
})

export function apply(ctx: Context, config: Config): void {
  const api: LighthouseApi = config.backend === 'bridge' ? createBridgeBackend(config) : createMockBackend()
  /** 动态注册云端全部工具（幂等）；启动时试一次（已有 token 场景），授权成功后回调再触发 */
  const ensureCloudTools = ensureCloudToolsRegistered(ctx, api, config)
  void ensureCloudTools()

  // ---- 精修工具 A：实例列表（多地域并行，内置 Region 处理）----
  ctx.tools.register(defineTool({
    name: 'lighthouse_list_instances',
    description:
      "List the user's Tencent Cloud Lighthouse (轻量应用服务器) instances: name, public IP, state, zone and specs. ALWAYS call this when the user asks about their cloud servers (我的服务器 / 实例列表 / 哪些在跑 / 机器状态). By default it queries 6 mainstream regions in parallel (北京/上海/广州/成都/南京/香港); if the user names a specific region (东京/新加坡/硅谷...), pass it as the region parameter. If the result says not authorized, tell the user to open the 🚀体验轻量云插件 panel in the left sidebar.",
    parameters: {
      region: {
        type: 'string',
        description: 'Optional region code (e.g. ap-tokyo / ap-singapore / na-siliconvalley). Omit to query 6 mainstream regions in parallel.',
      },
    },
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
    async execute(args) {
      const auth = await api.getAuthStatus()
      if (auth !== 'authorized') return unauthorized(auth)
      const r = await api.listInstances(String(args.region || ''))
      return cloneJson(r)
    },
  }))

  // ---- 精修工具 B：云端能力清单（云侧 MCP tools/list 透出，不触云资源）----
  // 注：实例重启/停止等具体操作随云端工具动态注册（accept 标记自动走 DSH 审批）；
  //     当前云端 60 工具中无 reboot_instances（只有 start_instances），已反馈云端补齐。
  ctx.tools.register(defineTool({
    name: 'lighthouse_list_cloud_tools',
    description:
      "List the cloud capabilities (MCP tools) available to the user after Tencent Cloud authorization, e.g. describe_instances / create_firewall_rules / describe_regions. ALWAYS call this when the user asks what cloud operations they can use (云端有哪些能力 / 能做什么 / 支持哪些操作 / 有哪些API). Returns tool names, Chinese display names, descriptions and required params. This only reads the capability list and does NOT touch any cloud resources.",
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [
        { type: 'text', text: renderCloudTools(value as unknown as CloudToolsPayload) },
      ],
      presentationMeta: (_args, value) => ({ kind: 'lighthouse-cloud-tools', ...(value as object) }),
    },
    presentCall: () => ({ card: 'generic', title: '轻量云 · 云端能力清单', kind: 'read', content: [] }),
    presentResult: (_args, { isError }) => ({
      card: 'generic',
      title: isError ? '轻量云 · 查询失败' : '轻量云 · 云端能力清单',
      content: [],
    }),
    timeoutMs: config.timeoutMs,
    async execute() {
      const auth = await api.getAuthStatus()
      if (auth !== 'authorized') return unauthorized(auth)
      return cloneJson({ tools: await api.listCloudTools() })
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
      handler: (req, res) => handleLighthouseApi(req, res, api, ensureCloudTools),
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
        'If a tool returns 未授权/not authorized, tell the user to open the 🚀体验轻量云插件 panel in the left sidebar and authorize, then retry. Never fabricate instance data.',
      ].join(' '),
    })
  })
}

// ---- 渲染辅助（对话里的纯文本形态；卡片形态由 client 的 toolview 负责）----

interface InstancesPayload {
  /** 云端返回的 Markdown 表格原文（远端 Agent 为 LLM 优化的格式，直接给对话模型读） */
  markdown?: string
  instances?: InstanceSummary[]
  regionsQueried?: string[]
  note?: string
  isError?: boolean
  message?: string
}

function renderInstances(value: InstancesPayload): string {
  if (value.isError) return value.message ?? '请求失败'
  const coverage = value.note ? `\n（查询范围说明，回答用户时可自然带出）：${value.note}` : ''
  // 远端 Agent 返回 Markdown 表格（为 LLM 优化）——原文直接给对话模型读，最鲁棒
  if (value.markdown) {
    const n = value.instances?.length ?? 0
    return [
      n > 0
        ? `卡片已展示 ${n} 台实例（内部数据，禁止复述序号给用户）：`
        : '云端返回了实例表格但未解析出结构化数据：',
      value.markdown,
      '对用户最多回一句短话；用户追问细节时再从表格里取字段回答。',
      coverage,
    ].join('\n')
  }
  const items = value.instances ?? []
  if (!items.length) {
    return [
      '没有查到实例。',
      coverage,
    ].filter(Boolean).join('\n')
  }
  const lines = items.map(
    (it, i) => `${i + 1}. ${it.instanceName || it.instanceId}（instanceId: ${it.instanceId}） · ${it.publicIp} · ${it.state} · ${it.cpu}C${it.memory}G · ${it.zone}`,
  )
  return [
    `卡片已展示 ${items.length} 台实例（内部序号，禁止复述给用户）：`,
    lines.join('\n'),
    '对用户最多回一句短话。禁止清单和长文。',
    coverage,
  ].join('\n')
}

interface CloudToolsPayload {
  tools?: CloudToolSummary[]
  isError?: boolean
  message?: string
}

function renderCloudTools(value: CloudToolsPayload): string {
  if (value.isError) return value.message ?? '请求失败'
  const items = value.tools ?? []
  if (!items.length) return '云端未放行任何工具。'
  const lines = items.map(
    (t, i) => `${i + 1}. ${t.displayName || t.name}（${t.name}）${t.requiredParams.length ? ` · 必填参数: ${t.requiredParams.join(', ')}` : ''} —— ${t.description}`,
  )
  return [
    `卡片已展示 ${items.length} 项云端能力（内部清单，禁止原文复述给用户）：`,
    lines.join('\n'),
    '向用户概括这些能力按类分组即可（如实例/防火墙/快照/域名等），不要逐条罗列全部 60 项。',
  ].join('\n')
}

function cloneJson(value: unknown) {
  return JSON.parse(JSON.stringify(value))
}

/** 未授权统一返回引导文案，不执行任何云 API 调用（curated 与动态注册工具共用） */
const unauthorized = (status: AuthStatus) => ({
  isError: true,
  authStatus: status,
  message:
    status === 'expired'
      ? '腾讯云授权已过期。请点击左侧「🚀体验轻量云插件」入口，按面板引导重新授权后再试。'
      : '尚未完成腾讯云授权。请点击左侧「🚀体验轻量云插件」入口，按面板引导完成授权后再试。',
})

// ---- 动态注册：云端 MCP 工具全量透出（与 WorkBuddy 管控一致）----
// 产品结论（2026-09-21）：与 WorkBuddy 管控一致——动态注册全部云端工具；
// 风险映射：云端 interactionType=accept → DSH execute 类（用户审批硬拦截），auto → read 类（直调）。

/**
 * JSON Schema draft-07（子集）→ dsh-tools value-schema DSL（递归）。
 * 支持嵌套：object 的 properties/required/additionalProperties、array 的 items。
 * 注意：dsh-tools 只接受受限关键词（type/oneOf/properties/required/additionalProperties/
 * items/enum/const + description/title/default/examples），maxLength 等必须丢弃；
 * object 节点的 additionalProperties 必须显式 boolean（云端通常为 false）。
 */
export function translateSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const props = (schema.properties ?? {}) as Record<string, any>
  const required = new Set(((schema.required ?? []) as unknown[]).map(String))
  const params: Record<string, any> = {}
  for (const [key, def] of Object.entries(props)) {
    params[key] = translateSchemaNode(def, required.has(key))
  }
  return params
}

/** 单节点翻译（递归）：类型映射 + 注释保留 + items/properties 递归；isRequired 由父级附加 */
function translateSchemaNode(def: any, isRequired: boolean): Record<string, any> {
  const rawType = String(def?.type ?? 'string')
  const type = rawType === 'integer' || rawType === 'number' ? 'number'
    : rawType === 'boolean' ? 'boolean'
    : rawType === 'array' ? 'array'
    : rawType === 'object' ? 'object'
    : 'string'
  const node: Record<string, any> = { type }
  if (def?.description) node.description = String(def.description)
  if (Array.isArray(def?.enum)) node.enum = def.enum
  if (def?.default !== undefined) node.default = def.default
  if (type === 'array' && def?.items) {
    node.items = translateSchemaNode(def.items, false)
  }
  if (type === 'object' && def?.properties) {
    node.properties = translateSchema(def)
    node.additionalProperties = def.additionalProperties === false ? false : true
  }
  if (isRequired) node.required = true
  return node
}

/** 动态注册入口（幂等）：拉 tools/list → 逐个注册为 lighthouse_{name}。curated 已覆盖的工具跳过。 */
function ensureCloudToolsRegistered(
  ctx: Context,
  api: LighthouseApi,
  config: Config,
): () => Promise<void> {
  let registered = false
  return async () => {
    if (registered) return
    let tools
    try {
      tools = await api.listCloudTools()
    } catch {
      return // 未授权或云端不可达时静默跳过（已有 curated 工具兜底）
    }
    const curated = new Set(['describe_instances']) // curated list/describe 已覆盖，避免重复
    const sensitiveNames = new Set<string>() // accept 类工具名（执行前拦截 → 弹审批卡）
    for (const t of tools) {
      if (curated.has(t.name)) continue
      const isSensitive = t.interactionType === 'accept'
      if (isSensitive) sensitiveNames.add(`lighthouse_${t.name}`)
      ctx.tools.register(defineTool({
        name: `lighthouse_${t.name}`,
        description: `[${t.displayName || t.name}] ${t.description}${isSensitive ? '（此操作需要用户审批确认后才会执行）' : ''}`,
        parameters: translateSchema(t.inputSchema) as any,
        output: {
          schema: { type: 'object', additionalProperties: true },
          render: (_args, value) => [
            { type: 'text', text: String((value as any)?.markdown ?? '') },
          ],
        },
        presentCall: () => ({
          card: 'generic',
          title: `轻量云 · ${t.displayName || t.name}`,
          kind: isSensitive ? 'execute' : 'read',
          content: [],
        }),
        presentResult: (_args, { isError }) => ({
          card: 'generic',
          title: `轻量云 · ${t.displayName || t.name}${isError ? '（失败）' : ''}`,
          content: [],
        }),
        timeoutMs: config.timeoutMs + (isSensitive ? 15000 : 0),
        async execute(args) {
          const auth = await api.getAuthStatus()
          if (auth !== 'authorized') return unauthorized(auth)
          const markdown = await api.callCloudTool(t.name, (args ?? {}) as Record<string, unknown>)
          return cloneJson({ markdown, tool: t.name })
        },
      }))
    }
    // accept 类工具的执行前拦截：向 tools/pre-execute 瀑布返回 ask → DSH approval seam 弹审批卡，
    // 用户确认后才放行（硬审批，强于 WorkBuddy 的提示词软确认）
    if (sensitiveNames.size) {
      ctx.on("tools/pre-execute", (exec, next) => {
        if (exec?.name && sensitiveNames.has(exec.name)) {
          return {
            kind: 'ask',
            reason: `「${exec.name.replace(/^lighthouse_/, '')}」属于需要确认的云端操作，请在审批卡中确认后执行`,
          } as any
        }
        return next()
      })
    }
    registered = true
  }
}
