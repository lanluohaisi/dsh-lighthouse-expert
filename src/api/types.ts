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

export type InstanceState = 'RUNNING' | 'STOPPED' | 'STARTING' | 'STOPPING' | 'REBOOTING'

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

export interface OperationResult {
  requestId: string
  success: boolean
  message: string
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
}

export interface LighthouseApi {
  /** 查询授权状态（含过期时自动刷新尝试） */
  getAuthStatus(): Promise<AuthStatus>
  /** 发起授权流：真实后端下调云端服务换取跳转地址；mock 下返回假 flowId */
  startAuthFlow(): Promise<AuthFlowStart>
  /** 轮询授权流；authorized 时实现方负责把令牌落地存储 */
  pollAuthFlow(flowId: string): Promise<AuthFlowPoll>
  listInstances(): Promise<InstanceSummary[]>
  describeInstance(instanceId: string): Promise<InstanceSummary | null>
  rebootInstances(instanceIds: string[]): Promise<OperationResult>
}
