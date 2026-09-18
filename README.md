# dsh-lighthouse-expert（轻量云专家）

腾讯云轻量应用服务器连接器 —— DeepSeek Harness (DSH) 插件。

- 需求：《轻量云专家-方案B执行计划.md》（工作区根目录）
- 参考：skillhub 源码（`../dsh-skillhub-demo/skillhub-main`）
- 状态：**阶段 1/2 骨架完成**，backend 默认 mock（假数据），bridge 等后端对齐

## 目录结构

```
├── package.json            # dsh.bundle + dsh.client 声明
├── cordis.patch.yml        # 正式发布 patch 行（id: lighthouse-expert）
├── dev-cordis.yml          # 本地 --patch 快速验证用
├── src/
│   ├── index.ts            # host：3 个工具 + 未授权守卫 + /lighthouse 路由 + settings
│   ├── api/
│   │   ├── types.ts        # ★ LighthouseApi 接口（mock/bridge 共同实现）
│   │   ├── mock.ts         # 假数据（初始未授权，可演示完整授权流程）
│   │   └── bridge.ts       # 后端桥（占位，抛未就绪；见执行计划阶段 3）
│   └── local-api.ts        # 面板数据源 HTTP 路由
└── client/
    └── client.js           # 左侧入口(order 7) + 授权面板 + 对话卡片
```

## 本地调试

### 方式一：--patch 快速验证（host 侧）

```bash
pnpm install && pnpm build
npx @deepseek-ai/dsh web --patch ./dev-cordis.yml
# 打开 http://127.0.0.1:3080
# 对话输入「查下我的轻量服务器」→ Agent 调 lighthouse_list_instances → mock 数据返回
```

**开发循环**：终端 1 跑 `pnpm build --watch`（改 src 自动重编译），终端 2 重启 dsh web 即可。

> ⚠️ dev-cordis.yml 的 `name` 必须指向编译产物 `lib/index.js`——TS 源码里的
> NodeNext 风格 import（`./api/mock.js`）在 Node 原生加载下不会映射回 `.ts`，
> 直接指向 src 会 `ERR_MODULE_NOT_FOUND`。

注意：此方式下 client 侧（左侧入口）可能不加载——dev overlay 直接指 host 入口，
不走 package.json 的完整发现链路。看左侧入口请用方式二。

### 方式二：完整安装（host + client 全链路）

```bash
pnpm install && pnpm build
npx @deepseek-ai/dsh plugin --profile dev add /Users/zhangyuanfang/exercise/dsh-lighthouse-expert
npx @deepseek-ai/dsh web --profile dev
# 左侧底部「插件广场」上方应出现「轻量云专家」
# 点击 → 授权引导 → 点「授权连接（演示）」→ 出现实例列表
```

### 在测试实例（203.195.206.97）上验证

```bash
scp -i ~/Desktop/abeltest.pem -r . ubuntu@203.195.206.97:~/dsh-lighthouse-expert
ssh -i ~/Desktop/abeltest.pem ubuntu@203.195.206.97
cd ~/dsh-lighthouse-expert && pnpm install && pnpm build
dsh plugin --profile web add ~/dsh-lighthouse-expert   # 注意：会写入 web profile，验证完可 remove
sudo systemctl restart deepseek-harness.service
```

## 路由契约（host ↔ client）

```
GET  /lighthouse?action=status               → { auth }
GET  /lighthouse?action=list                 → { auth, instances[] }
POST /lighthouse?action=authorize            → { auth }
POST /lighthouse?action=reboot&id=lhins-xxx  → OperationResult
```

## TODO（对照执行计划）

- [ ] 3.1 bridge.ts 真实实现（等后端 0.1 对齐会结论）
- [ ] 3.2 授权状态同步（轮询 or 推送）
- [ ] 2.x 打磨：i18n 跟随 locale 切换、面板刷新按钮、重启按钮（带确认）
- [ ] 广场降级引导（D5：无桥环境显示「需要 Lighthouse Agent 环境」）
- [ ] 测试（照 skillhub 的 vitest 布局补 src/tests）
