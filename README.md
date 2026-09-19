# dsh-lighthouse-expert（轻量云专家）

腾讯云轻量应用服务器（Lighthouse）连接器 —— [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/)（DSH）插件。

安装后，可在 DSH WebUI 中直接管理你的腾讯云轻量应用服务器：

- **左侧导航入口**：一键查看实例列表与运行状态
- **对话式操作**：直接问"查下我的轻量服务器""重启 web-server"，Agent 自动调用对应工具
- **安全设计**：OAuth 扫码授权（用户级权限，只访问你自己的资源）；重启等高危操作走审批确认；令牌仅存于你的本机，云端零存储

## 安装

```bash
# 在 DeepSeek Harness 环境中（Node >= 22）：
dsh plugin --profile web add github:lanluohaisi/dsh-lighthouse-expert
dsh web   # 启动 WebUI，左侧「插件广场」上方出现「轻量云专家」
```

**首次使用**：点击左侧「轻量云专家」→「授权连接」→ 腾讯云扫码授权 → 即可查看/操作你的实例。

> 授权与云 API 调用依赖 Lighthouse Agent 云端服务（lightai.cloud.tencent.com）。

## 工具

| 工具 | 说明 | 高危 |
|---|---|---|
| `lighthouse_list_instances` | 查询实例列表（名称/IP/状态/规格/可用区） | 否 |
| `lighthouse_describe_instance` | 查询单实例详情 | 否 |
| `lighthouse_reboot_instances` | 重启实例（需 DSH 审批确认） | 是 |

## 目录结构

```
├── package.json            # dsh.bundle + dsh.client 声明
├── cordis.patch.yml        # 发布用 patch 行（id: lighthouse-expert）
├── dev-cordis.yml          # 本地 --patch 快速验证模板
├── src/
│   ├── index.ts            # host：工具注册 + 未授权守卫 + /lighthouse 路由 + settings
│   ├── api/
│   │   ├── types.ts        # LighthouseApi 接口定义
│   │   ├── mock.ts         # 内置演示数据（无需联网，默认 backend='mock' 时生效）
│   │   └── bridge.ts       # 真实云端实现（OAuth 授权 + MCP 调用 + 令牌管理）
│   └── local-api.ts        # 面板数据源 HTTP 路由
└── client/
    └── client.js           # 左侧导航入口 + 授权面板 + 对话卡片
```

## 配置

| 项 | 默认值 | 说明 |
|---|---|---|
| `backend` | `bridge` | `bridge` 真实云端链路；`mock` 内置演示数据（开发调试用） |
| `apiBase` | `https://lightai.cloud.tencent.com` | 云端服务地址 |
| `timeoutMs` | `20000` | 请求超时（毫秒） |

可在 profile 的 `cordis.patch.yml` 中覆盖（按 `id: lighthouse-expert` 匹配整行替换）。

## 本地开发

```bash
pnpm install && pnpm build
npx @deepseek-ai/dsh plugin --profile dev add <本仓库绝对路径>
npx @deepseek-ai/dsh --profile dev web
```

- 开发循环：`pnpm build --watch` 挂后台，改完重启 dsh web 即可
- `dev-cordis.yml` 的 `name` 必须指向编译产物 `lib/index.js`（NodeNext 风格 import 在 Node 原生加载 `.ts` 时不会映射回 `.ts`，直接指 src 会 `ERR_MODULE_NOT_FOUND`）
- 令牌存放位置：`$DSH_HOME/lighthouse-expert/tokens.json`（0600）；删除该文件即"取消授权"

## host ↔ client 路由契约

```
GET  /lighthouse?action=status                → { auth }
GET  /lighthouse?action=list                  → { auth, instances[] }
POST /lighthouse?action=auth-start            → { flowId, authorizeUrl }
GET  /lighthouse?action=auth-status&flowId=   → { status, message? }
POST /lighthouse?action=reboot&id=lhins-xxx   → OperationResult
```

## Roadmap

- [ ] i18n 多语言（接入 locale 服务）
- [ ] 面板操作按钮（刷新 / 重启确认）
- [ ] 单元测试
- [ ] 更多实例操作工具（防火墙 / 快照 / 监控）

## License

[MIT](./LICENSE)
