/**
 * LighthouseApi —— 后端能力抽象层。
 *
 * host 侧（tools / local-api）只依赖这个接口，不关心后端是谁：
 *   - mock.ts   内置演示数据，无需联网即可体验完整流程
 *   - bridge.ts 真实云端服务（OAuth 授权 + MCP 工具调用）
 *
 * 授权采用轮询模式：面板发起后跳转腾讯云登录页，随后轮询结果；
 * authorized 时令牌由实现方落地本地存储，对外只返回状态（令牌不经过浏览器）。
 */

export type AuthStatus = 'authorized' | 'unauthorized' | 'expired'

/** 实例状态（云端可能返回 SHUTDOWN/FREEZING/RESCUE_MODE 等扩展态，此处不穷举） */
export type InstanceState = 'RUNNING' | 'STOPPED' | 'STARTING' | 'STOPPING' | 'REBOOTING' | (string & {})

export interface InstanceSummary {
  instanceId: string
  instanceName: string
  publicIp: string
  privateIp: string
  zone: string
  state: InstanceState
  cpu: number
  memory: number
  createdAt: string
}

/** 发起授权的结果。authorizeUrl 为 null 时（mock）面板跳过跳转直接轮询 */
export interface AuthFlowStart {
  flowId: string
  authorizeUrl: string | null
}

/** 轮询授权状态。authorized 时令牌已被实现方存储，面板只需刷新自身 */
export interface AuthFlowPoll {
  status: 'pending' | 'authorized' | 'error'
  message?: string
}

/** bridge 模式所需配置（与 index.ts 的 Config 字段对齐，避免循环依赖） */
export interface BridgeConfig {
  apiBase: string
  timeoutMs: number
  /** 腾讯云地域（云端 MCP 工具的必填参数），如 ap-guangzhou / ap-beijing */
  region: string
}

/** 云端 MCP 放行的工具摘要（tools/list 结果） */
export interface CloudToolSummary {
  name: string
  displayName: string
  description: string
  requiredParams: string[]
  /** 云端风险标记：accept=需用户确认；auto=可自动执行 */
  interactionType: 'auto' | 'accept' | string
  /** JSON Schema draft-07 参数定义（动态注册时翻译为 DSH 参数格式） */
  inputSchema: Record<string, unknown>
}

/** 云端工具返回的实例列表（Markdown 原文 + 尽力解析的结构化数据） */
export interface InstanceListResult {
  /** 云端返回的 Markdown 表格原文（远端 Agent 为 LLM 优化的输出格式，直接透传给对话模型） */
  markdown: string
  /** 从 Markdown 宽松解析出的结构化实例（供面板卡片渲染；字段缺失时可能不完整） */
  instances: InstanceSummary[]
  /** 本次实际查询的地域列表（多地域并行时 >1 项） */
  regionsQueried: string[]
  /** 给 LLM 的覆盖范围提示（并行查主流地域时说明可能遗漏的范围） */
  note?: string
}

export interface LighthouseApi {
  /** 查询授权状态（含过期时自动刷新尝试） */
  getAuthStatus(): Promise<AuthStatus>
  /** 发起授权流：真实后端下调云端服务换取跳转地址；mock 下返回假 flowId */
  startAuthFlow(): Promise<AuthFlowStart>
  /** 轮询授权流；authorized 时实现方负责把令牌落地存储 */
  pollAuthFlow(flowId: string): Promise<AuthFlowPoll>
  /** 查询实例；不传地域时并行查主流 6 地域，传入则精确查单地域 */
  listInstances(region?: string): Promise<InstanceListResult>
  /** 云端 MCP 放行的工具清单（tools/list），给用户展示"云端放行了哪些能力" */
  listCloudTools(): Promise<CloudToolSummary[]>
  /** 通用云端工具调用（动态注册的 60 个工具的统一代理）：返回 markdown 文本（远端为 LLM 优化的格式） */
  callCloudTool(name: string, args: Record<string, unknown>): Promise<string>
}
