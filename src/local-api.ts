/**
 * /lighthouse 本地 HTTP 路由 —— 面板的数据源。
 *
 * 由 host 侧 ctx.inject(['webServer']) 注册（见 index.ts），与 WebUI 同源，
 * client 里直接 fetch('/lighthouse?...') 即可，无跨域问题。
 * 面板不直连云端服务（跨域限制），全部经 host 转发；令牌只在 host 侧流转，不经过浏览器。
 *
 * 路由契约：
 *   GET  /lighthouse?action=status               → { auth }
 *   GET  /lighthouse?action=list                 → { auth, instances[], markdown? }
 *   GET  /lighthouse?action=tools                → { auth, tools[] }       ← 云端能力清单
 *   POST /lighthouse?action=auth-start           → { flowId, authorizeUrl }   ← 发起授权
 *   GET  /lighthouse?action=auth-status&flowId=  → { status, message? }       ← 轮询（authorized 时触发动态注册）
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { LighthouseApi } from './api/types.js'

export function handleLighthouseApi(
  req: IncomingMessage,
  res: ServerResponse,
  api: LighthouseApi,
  onAuthorized?: () => void,
): void {
  void (async () => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const action = url.searchParams.get('action') ?? 'status'

    const send = (code: number, data: unknown) => {
      res.statusCode = code
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify(data))
    }

    try {
      if (req.method === 'GET' && action === 'status') {
        return send(200, { auth: await api.getAuthStatus() })
      }

      if (req.method === 'GET' && action === 'list') {
        const auth = await api.getAuthStatus()
        if (auth !== 'authorized') return send(200, { auth, instances: [] })
        const r = await api.listInstances()
        return send(200, { auth, instances: r.instances, markdown: r.markdown })
      }

      if (req.method === 'GET' && action === 'tools') {
        const auth = await api.getAuthStatus()
        if (auth !== 'authorized') return send(200, { auth, tools: [] })
        return send(200, { auth, tools: await api.listCloudTools() })
      }

      if (req.method === 'POST' && action === 'auth-start') {
        return send(200, await api.startAuthFlow())
      }

      if (req.method === 'GET' && action === 'auth-status') {
        const flowId = url.searchParams.get('flowId') ?? ''
        // authorized 时令牌已由 bridge 落地本地存储，此处只回状态
        const poll = await api.pollAuthFlow(flowId)
        if (poll.status === 'authorized') onAuthorized?.()
        return send(200, poll)
      }

      return send(404, { error: `unknown action: ${action}` })
    } catch (err) {
      return send(500, { error: err instanceof Error ? err.message : String(err) })
    }
  })()
}
