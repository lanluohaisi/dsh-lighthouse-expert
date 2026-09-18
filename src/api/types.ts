/**
 * LighthouseApi —— 本计划的核心抽象层。
 *
 * host 侧（tools / local-api）只依赖这个接口，不关心后端是谁：
 *   - mock.ts   内存假数据，撑起全链路开发调试（现在就能跑）
 *   - bridge.ts 走 ai-server WorkBuddy 体系（轮询授权 + Bearer 调 MCP）
 *
 * 轮询模式接口（2026-09-16 定稿，对照《轻量云专家-后端改动方案.md》）：
 *   startAuthFlow → 面板 window.open(authorizeUrl)
 *   pollAuthFlow  → 面板每 2s 轮询；authorized 时 token 由实现方落地存储，
 *                   对外只返回状态（token 不经过浏览器）
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
  /** 发起授权流：bridge 下调 ai-server dsh/start；mock 下返回假 flowId */
  startAuthFlow(): Promise<AuthFlowStart>
  /** 轮询授权流；authorized 时实现方负责把令牌落地存储 */
  pollAuthFlow(flowId: string): Promise<AuthFlowPoll>
  listInstances(): Promise<InstanceSummary[]>
  describeInstance(instanceId: string): Promise<InstanceSummary | null>
  rebootInstances(instanceIds: string[]): Promise<OperationResult>
}
