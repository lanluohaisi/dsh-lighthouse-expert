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
  CloudToolSummary,
  InstanceListResult,
  InstanceSummary,
  LighthouseApi,
} from './types.js'

const MOCK_INSTANCES: InstanceSummary[] = [
  {
    instanceId: 'lhins-mock0001',
    instanceName: 'demo-instance',
    publicIp: '203.0.113.10',
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

/** mock 云端工具清单（演示 tools/list 透出能力） */
const MOCK_CLOUD_TOOLS: CloudToolSummary[] = [
  {
    name: 'describe_instances',
    displayName: '查询实例列表',
    description: '查询用户轻量应用服务器实例列表，含名称、IP、状态、规格、可用区等信息。',
    requiredParams: ['Region'],
    interactionType: 'auto',
    inputSchema: {
      type: 'object',
      properties: { Region: { type: 'string', description: '地域，如 ap-beijing' } },
      required: ['Region'],
    },
  },
  {
    name: 'start_instances',
    displayName: '开启实例',
    description: '开启一台或多台处于关机状态的轻量应用服务器实例。',
    requiredParams: ['Region', 'InstanceIds'],
    interactionType: 'accept',
    inputSchema: {
      type: 'object',
      properties: {
        Region: { type: 'string', description: '地域，如 ap-beijing' },
        InstanceIds: { type: 'array', items: { type: 'string' }, description: '实例 ID 列表' },
      },
      required: ['Region', 'InstanceIds'],
    },
  },
  {
    name: 'create_firewall_rules',
    displayName: '添加防火墙规则',
    description: '在实例上添加防火墙规则，控制实例的网络访问策略。',
    requiredParams: ['Region', 'InstanceId', 'FirewallRules'],
    interactionType: 'accept',
    inputSchema: {
      type: 'object',
      properties: {
        Region: { type: 'string', description: '地域，如 ap-beijing' },
        InstanceId: { type: 'string', description: '实例 ID' },
      },
      required: ['Region', 'InstanceId'],
    },
  },
  {
    name: 'describe_regions',
    displayName: '查询地域列表',
    description: '查询轻量应用服务器可用地域列表。',
    requiredParams: [],
    interactionType: 'auto',
    inputSchema: { type: 'object', properties: {}, required: [] },
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

    async revokeAuth(): Promise<void> {
      auth = 'unauthorized'
    },

    async pollAuthFlow(flowId: string): Promise<AuthFlowPoll> {
      const created = flowCreatedAt.get(flowId)
      if (created == null) return { status: 'error', message: 'unknown flowId' }
      if (Date.now() - created < MOCK_LOGIN_DELAY_MS) return { status: 'pending' }
      flowCreatedAt.delete(flowId)
      auth = 'authorized'
      return { status: 'authorized' }
    },

    async listInstances(region?: string): Promise<InstanceListResult> {
      await delay(300)
      if (region) {
        return {
          markdown: '',
          instances: MOCK_INSTANCES.filter((it) => it.zone.startsWith(region)).map((it) => ({ ...it })),
          regionsQueried: [region],
          note: `（mock）已查询指定地域 ${region}。`,
        }
      }
      const regions = ['ap-beijing', 'ap-shanghai', 'ap-guangzhou', 'ap-chengdu', 'ap-nanjing', 'ap-hongkong']
      return {
        markdown: '',
        instances: MOCK_INSTANCES.map((it) => ({ ...it })),
        regionsQueried: regions,
        note: '（mock）已并行查询 6 个主流地域，命中 ap-beijing（演示数据）。',
      }
    },

    async listCloudTools(): Promise<CloudToolSummary[]> {
      await delay(300)
      return MOCK_CLOUD_TOOLS.map((it) => ({
        ...it,
        interactionType: it.interactionType ?? 'auto',
        inputSchema: it.inputSchema ?? {},
      }))
    },

    async callCloudTool(name: string, args: Record<string, unknown>): Promise<string> {
      await delay(500)
      const hit = MOCK_CLOUD_TOOLS.find((t) => t.name === name)
      if (!hit) return `工具 ${name} 不存在（mock）`
      return `（mock）已执行 ${hit.displayName || name}，参数：${JSON.stringify(args)}`
    },
  }
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
