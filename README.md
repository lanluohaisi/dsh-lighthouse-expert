# dsh-lighthouse-expert（🚀体验轻量云插件）

腾讯云轻量应用服务器（Lighthouse）连接器 —— [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/)（DSH）插件。

安装后，可在 DSH WebUI 中直接管理你的腾讯云轻量应用服务器：

- **左侧导航入口**：授权引导（含能力介绍）→ 授权成功后展示可用操作与示例话术
- **对话式操作**：授权后云端 MCP 的全部工具动态注册给 Agent（实例/防火墙/快照/云硬盘/域名解析/监控自检/远程命令，约 60 项），直接对话即可调用
- **安全设计**：OAuth 扫码授权（用户级权限，只访问你自己的资源）；云端标记为需确认的操作（重启/修改/删除类）自动映射为 DSH 审批，用户点确认才执行；令牌仅存于你的本机，云端零存储

## 安装

```bash
# 在 DeepSeek Harness 环境中（Node >= 22）：
# # 后为 commit hash（插件广场按此 pin 安装，不用 tag 名）
dsh plugin --profile web add github:lanluohaisi/dsh-lighthouse-expert#497e826
dsh web   # 启动 WebUI，侧栏底部操作区出现「🚀体验轻量云插件」入口
```

**首次使用**：点击左侧「🚀体验轻量云插件」→「授权连接」→ 腾讯云扫码授权 → 即可查看/操作你的实例。

> - 授权与云 API 调用依赖 Lighthouse Agent 云端服务（lightai.cloud.tencent.com），该服务分阶段开放中。若「授权连接」报错，说明服务尚未对你的环境开放，可在插件配置中把 `backend` 设为 `mock` 先体验完整交互流程
> - 入口位置在侧栏底部操作区，具体排布随所在 DSH 环境自适应（可通过插件配置调整 order）

## 工具

**精修工具（插件内置注册）**：

| 工具 | 说明 |
|---|---|
| `lighthouse_list_instances` | 查询实例列表（名称/IP/状态/规格/可用区，含 Markdown 原文透传） |
| `lighthouse_list_cloud_tools` | 云端能力清单（tools/list 透出，用户问"能做什么"时调用） |

**动态注册（授权成功后自动）**：插件调云端 `tools/list` 拉取全部工具（约 60 项：describe_instances / create_firewall_rules / start_instances / get_monitor_data / execute_command ...），逐个翻译 schema 注册为 `lighthouse_{name}`。风险映射遵循云端标记：`accept`（修改/删除类）→ DSH execute 类**走用户审批**；`auto`（查询类）→ read 类直调。与 WorkBuddy 的管控粒度一致。

## 目录结构

```
├── package.json            # dsh.bundle + dsh.client 声明
├── cordis.patch.yml        # 发布用 patch 行（id: lighthouse-expert）
├── dev-cordis.yml          # 本地 --patch 快速验证模板
├── src/
│   ├── index.ts            # host：精修工具注册 + 动态注册（60 云端工具 + 审批映射）+ /lighthouse 路由
│   ├── api/
│   │   ├── types.ts        # LighthouseApi 接口 + 云端工具/实例类型定义
│   │   ├── mock.ts         # 内置演示数据（backend 配置为 mock 时生效，无需联网）
│   │   └── bridge.ts       # 真实云端实现（OAuth 授权 + MCP 调用 + 令牌管理 + Markdown 解析）
│   └── local-api.ts        # 面板数据源 HTTP 路由（含 authorized → 动态注册钩子）
└── client/
    └── client.js           # 左侧导航入口 + 授权引导/能力介绍面板 + 对话卡片
```

## 配置

| 项 | 默认值 | 说明 |
|---|---|---|
| `backend` | `bridge` | `bridge` 真实云端链路；`mock` 内置演示数据（开发调试用） |
| `apiBase` | `https://lightai.cloud.tencent.com` | 云端服务地址 |
| `timeoutMs` | `20000` | 请求超时（毫秒） |
| `region` | `ap-guangzhou` | 首选地域（云端 MCP 工具必填参数；实例不在该地域时对话中可让 Agent 指定其他地域） |

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
GET  /lighthouse?action=list                  → { auth, instances[], markdown? }
GET  /lighthouse?action=tools                 → { auth, tools[] }     ← 云端能力清单（含 interactionType/inputSchema）
POST /lighthouse?action=auth-start            → { flowId, authorizeUrl }
GET  /lighthouse?action=auth-status&flowId=   → { status, message? }  ← authorized 时 host 触发动态注册
```

## Roadmap

- [ ] i18n 多语言（接入 locale 服务）
- [ ] 实例列表多地域聚合（空结果时并发扫描全部地域，用户零配置）
- [ ] 单元测试（translateSchema / parseInstancesFromMarkdown 纯函数优先）
- [ ] 云端补 reboot_instances 工具后自动纳入动态注册

## License

[MIT](./LICENSE)
