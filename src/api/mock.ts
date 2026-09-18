/**
 * MockBackend —— 内存假数据实现。
 *
 * 轮询模式模拟：startAuthFlow 返回 authorizeUrl=null（面板不跳转），
 * pollAuthFlow 在 flow 创建 1.2 秒后返回 authorized——演示完整授权流程节奏。
 */
import type {
  AuthFlowPoll,
  AuthFlowStart,
  AuthStatus,
  InstanceSummary,
  LighthouseApi,
  OperationResult,
} from './types.js'

const MOCK_INSTANCES: InstanceSummary[] = [
  {
    instanceId: 'lhins-mock0001',
    instanceName: 'abeljifulu-Hermes',
    publicIp: '203.195.206.97',
    privateIp: '10.0.8.21',
    zone: 'ap-guangzhou',
    state: 'RUNNING',
    cpu: 2,
    memory: 2,
    createdAt: '2026-09-10T14:30:00+08:00',
  },
  {
    instanceId: 'lhins-mock0002',
    instanceName: 'web-server',
    publicIp: '129.211.123.45',
    privateIp: '10.0.8.22',
    zone: 'ap-shanghai',
    state: 'STOPPED',
    cpu: 2,
    memory: 4,
    createdAt: '2026-08-02T10:00:00+08:00',
  },
  {
    instanceId: 'lhins-mock0003',
    instanceName: 'dev-node',
    publicIp: '43.135.66.78',
    privateIp: '10.0.8.23',
    zone: 'ap-beijing',
    state: 'RUNNING',
    cpu: 4,
    memory: 8,
    createdAt: '2026-07-18T09:12:00+08:00',
  },
]

/** 模拟用户在腾讯云登录页停留的时长（毫秒）：期间轮询返回 pending */
const MOCK_LOGIN_DELAY_MS = 1200

export function createMockBackend(): LighthouseApi {
  let auth: AuthStatus = 'unauthorized'
  const flowCreatedAt = new Map<string, number>()

  return {
    async getAuthStatus(): Promise<AuthStatus> {
      return auth
    },

    async startAuthFlow(): Promise<AuthFlowStart> {
      const flowId = `mock-flow-${Date.now()}`
      flowCreatedAt.set(flowId, Date.now())
      return { flowId, authorizeUrl: null } // mock：无真实跳转页
    },

    async pollAuthFlow(flowId: string): Promise<AuthFlowPoll> {
      const created = flowCreatedAt.get(flowId)
      if (created == null) return { status: 'error', message: 'unknown flowId' }
      if (Date.now() - created < MOCK_LOGIN_DELAY_MS) return { status: 'pending' }
      flowCreatedAt.delete(flowId)
      auth = 'authorized'
      return { status: 'authorized' }
    },

    async listInstances(): Promise<InstanceSummary[]> {
      await delay(300)
      return MOCK_INSTANCES.map((it) => ({ ...it }))
    },

    async describeInstance(instanceId: string): Promise<InstanceSummary | null> {
      await delay(200)
      const hit = MOCK_INSTANCES.find((it) => it.instanceId === instanceId)
      return hit ? { ...hit } : null
    },

    async rebootInstances(instanceIds: string[]): Promise<OperationResult> {
      await delay(1500)
      for (const id of instanceIds) {
        const hit = MOCK_INSTANCES.find((it) => it.instanceId === id)
        if (hit) hit.state = 'RUNNING'
      }
      return {
        requestId: `mock-${Date.now()}`,
        success: true,
        message: `已向 ${instanceIds.length} 台实例下发重启指令（mock）`,
      }
    },
  }
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
