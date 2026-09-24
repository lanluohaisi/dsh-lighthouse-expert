/**
 * 体验轻量云插件 —— client 侧（浏览器）。
 *
 * 由 DSH WebUI 的 ModuleLoader 在浏览器执行：
 *   window.__ModuleLoader__.load({ id, factory: (require) => ({ inject, apply }) })
 *
 * 注册内容：
 *   1. sidebar.footer.action 左侧导航入口（order 决定在侧栏底部操作区的排序，
 *      数值越小越靠上；不同 DSH 环境内置入口不同，位置自适应）
 *   2. 点击弹出的操作面板（授权引导 / 实例列表），数据来自 host 的 /lighthouse 路由
 *   3. tool.call.toolview —— 三个工具的对话卡片渲染
 */
window.__ModuleLoader__.load({
  id: "dsh-lighthouse-expert",
  factory: (require) => {
    const React = require("react");
    const h = React.createElement;
    const { useEffect, useRef, useState } = React;

    // ---- 样式（lex- 前缀，主题色对齐 dsw CSS 变量）----
    const CSS = `
.lex-entry{position:relative}
.lex-trigger{display:flex;align-items:center;gap:8px;width:100%;padding:8px 10px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:13px;cursor:pointer;transition:background .16s;text-align:left}
.lex-trigger:hover{background:var(--dsw-interactive-bg-hover,rgba(38,49,72,.06))}
.lex-trigger__label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lex-overlay{position:fixed;inset:0;z-index:2147483000;background:var(--dsw-alias-bg-mask-3,rgba(15,23,42,.48));display:flex;align-items:center;justify-content:center;padding:24px 16px;box-sizing:border-box}
.lex-drawer{position:relative;width:min(680px,100%);max-height:min(82vh,800px);margin:0 auto;background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,inherit);border:1px solid var(--dsw-alias-border-l2,#9aa5b5);border-radius:12px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 18px 50px rgba(15,23,42,.28)}
.lex-close{position:absolute;top:10px;right:10px;width:32px;height:32px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#d1d5db);background:var(--dsw-alias-bg-layer-3,#fff);cursor:pointer;font-size:18px;line-height:1;color:var(--dsw-alias-label-secondary,#6b7280);z-index:2}
.lex-head{display:flex;gap:14px;align-items:center;padding:18px 48px 16px 18px;border-bottom:1px solid var(--dsw-alias-border-l2,#e5e7eb)}
.lex-title{font-size:16px;font-weight:650}
.lex-sub{font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280);margin-top:2px}
.lex-body{overflow:auto;padding:16px 18px;display:flex;flex-direction:column;gap:12px}
.lex-card{display:flex;gap:12px;align-items:center;background:var(--dsw-alias-bg-layer-3,#fff);border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:12px;padding:12px}
.lex-card__dot{width:10px;height:10px;border-radius:50%;flex:none;align-self:center;margin:0 2px}
.lex-card__dot--ok{background:#00a870}
.lex-card__dot--off{background:#9aa4b2}
.lex-card__dot--busy{background:#ff9c00}
.lex-card__main{flex:1;min-width:0}
.lex-card__name{font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lex-card__meta{font-size:11px;color:var(--dsw-alias-label-tertiary,#6b7280);margin-top:2px}
.lex-badge{flex:none;font-size:11px;padding:2px 8px;border-radius:999px;font-weight:600}
.lex-badge--ok{background:#e6fff4;color:#00875a}
.lex-badge--off{background:#f2f3f5;color:#6b7280}
.lex-badge--busy{background:#e8f1ff;color:#0052d9}
.lex-auth{padding:28px 22px;text-align:center}
.lex-auth p{color:var(--dsw-alias-label-secondary,#4b5563);font-size:13px;line-height:1.8;margin:0 0 16px}
.lex-btn{appearance:none;border:0;border-radius:8px;padding:9px 18px;font:inherit;font-size:13px;cursor:pointer}
.lex-btn--primary{background:#0052d9;color:#fff}
.lex-btn--primary:disabled{opacity:.6;cursor:default}
.lex-state{padding:32px;text-align:center;color:var(--dsw-alias-label-tertiary,#6b7280);font-size:13px}
.lex-post{gap:10px}
.lex-post-headline-row{display:flex;align-items:center;justify-content:space-between;gap:12px}
.lex-post-headline{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary,#111827)}
.lex-revoke-btn{border:1px solid var(--dsw-alias-border-l2,#dcdfe6);background:var(--dsw-alias-bg-layer-3,#fff);color:var(--dsw-alias-label-secondary,#4b5563);font:inherit;font-size:12px;padding:5px 12px;border-radius:8px;cursor:pointer;white-space:nowrap;transition:color .16s,border-color .16s,background .16s}
.lex-revoke-btn:hover{color:#e5484d;border-color:#e5484d;background:rgba(229,72,77,.06)}
.lex-post-features{font-size:12.5px;line-height:1.9;color:var(--dsw-alias-label-secondary,#4b5563);background:var(--dsw-alias-fill-l2,#f3f4f6);border-radius:8px;padding:10px 12px}
.lex-post-hint{font-size:12.5px;color:var(--dsw-alias-label-tertiary,#6b7280);line-height:1.7;margin:0}
.lex-post-examples{font-size:12.5px;color:var(--dsw-alias-label-secondary,#4b5563);line-height:1.8;margin:0}
.lex-feature-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px 12px;font-size:12.5px;color:var(--dsw-alias-label-secondary,#4b5563);background:var(--dsw-alias-fill-l2,#f3f4f6);border-radius:8px;padding:12px 14px;text-align:left}
.lex-feature-grid span{white-space:nowrap}
.lex-auth .lex-btn{margin-top:16px}
.lex-error{margin:0;padding:10px 18px 14px;color:#c0392b;font-size:12px}
.lex-tv{display:flex;flex-direction:column;gap:10px;padding:4px 2px}
.lex-tv__raw{font-size:11px;background:var(--dsw-alias-markdown-tag,#f3f4f6);border-radius:8px;padding:10px;overflow:auto;margin:0}
`;
    let cssDone = false;
    function ensureCss() {
      if (cssDone) return;
      cssDone = true;
      const el = document.createElement("style");
      el.textContent = CSS;
      document.head.appendChild(el);
    }

    // ---- i18n（当前默认中文；可接入 locale 服务实现多语言切换）----
    const ZH = {
      "entry.title": "🚀体验轻量云插件",
      "panel.subtitle": "腾讯云轻量应用服务器连接器",
      "auth.desc": "连接腾讯云轻量应用服务器前，需要先完成授权。授权仅用于访问你自己的实例资源，不会扩大权限。",
      "auth.features": ["🖥 查询/管理实例", "🛡 配置防火墙", "📸 管理快照备份", "💾 查看云硬盘", "🌐 管理域名解析", "📊 监控与自检", "🧰 远程执行命令"],
      "auth.go": "授权连接",
      "auth.waiting": "等待授权完成…请在弹出的腾讯云页面完成登录授权",
      "auth.fail": "授权失败",
      "auth.timeout": "授权超时，请重试",
      "post.headline": "✅ 授权成功，已接入云端全部运维能力",
      "post.desc": "直接在下方对话框告诉我你想做什么，例如：",
      "post.examples": "“查下我的服务器” · “看看防火墙规则” · “给实例做个自检” · “看看流量包还剩多少”",
      "post.revoke": "取消授权",
      "state.checking": "正在检查授权状态…",
    };
    const EN = {
      "entry.title": "🚀Lighthouse Plugin",
      "panel.subtitle": "Tencent Cloud Lighthouse connector",
      "auth.desc": "Authorization is required before connecting to Tencent Cloud Lighthouse. It only grants access to your own instances.",
      "auth.features": ["🖥 manage instances", "🛡 configure firewalls", "📸 snapshots & backups", "💾 cloud disks", "🌐 domains & DNS", "📊 monitoring & self-test", "🧰 remote commands"],
      "auth.go": "Authorize",
      "auth.waiting": "Waiting for authorization… please finish login in the Tencent Cloud page",
      "auth.fail": "Authorization failed",
      "auth.timeout": "Authorization timed out, please retry",
      "post.headline": "✅ Authorized — all cloud capabilities connected",
      "post.desc": "Just tell me what you want in the chat, e.g.:",
      "post.examples": "\"list my servers\" · \"show firewall rules\" · \"run a self-test\"",
      "post.revoke": "Revoke access",
      "state.checking": "Checking authorization…",
    };
    let dict = ZH;
    function lookup(key) {
      return dict[key] || key;
    }

    // ---- 兼容不同 DSH 版本的 slot 定位：list 型用 id、keyed 型用 key，两个都传 ----
    function registerSlot(slots, options, component) {
      const next = { ...options };
      if (next.id == null && next.key != null) next.id = String(next.key);
      if (next.key == null && next.id != null) next.key = next.id;
      return slots.register(next, component);
    }

    // ---- 实例卡片 ----
    const STATE_META = {
      RUNNING: { label: "运行中", cls: "ok" },
      STOPPED: { label: "已关机", cls: "off" },
      STARTING: { label: "开机中", cls: "busy" },
      STOPPING: { label: "关机中", cls: "busy" },
      REBOOTING: { label: "重启中", cls: "busy" },
    };

    function InstanceCard(props) {
      const x = props.instance;
      const meta = STATE_META[x.state] || { label: x.state, cls: "busy" };
      return h(
        "div",
        { className: "lex-card" },
        h("span", { className: `lex-card__dot lex-card__dot--${meta.cls}`, "aria-hidden": true }),
        h(
          "div",
          { className: "lex-card__main" },
          h("div", { className: "lex-card__name", title: x.instanceId }, x.instanceName || x.instanceId),
          h(
            "div",
            { className: "lex-card__meta" },
            [x.publicIp, x.zone, x.cpu + "C" + x.memory + "G"].filter(Boolean).join(" · "),
          ),
        ),
        h("span", { className: "lex-badge lex-badge--" + meta.cls }, meta.label),
      );
    }

    // ---- 操作面板（数据走 host 的 /lighthouse 路由；授权走轮询模式）----
    function ExpertPanel(props) {
      const [auth, setAuth] = useState("checking");
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState("");
      const pollRef = useRef(null);

      function stopPoll() {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }

      // 卸载时清理轮询定时器
      useEffect(() => () => stopPoll(), []);

      async function refresh() {
        try {
          // 只检查授权状态，不自动拉实例（地域未知时直接拉列表会显示错误结果）
          const res = await fetch("/lighthouse?action=status");
          const data = await res.json();
          setAuth(data.auth);
          setError("");
        } catch (err) {
          setError(String(err));
        }
      }

      useEffect(() => {
        void refresh();
      }, []);

      /**
       * 轮询模式授权：
       * 1. POST auth-start 拿 { flowId, authorizeUrl }
       * 2. authorizeUrl 存在则 window.open 腾讯云登录页（mock 模式为 null 不跳转）
       * 3. 每 2s 轮询 auth-status；authorized 时 host 已存好令牌，面板直接刷新
       */
      async function revokeAuth() {
        setBusy(true);
        setError("");
        try {
          await fetch("/lighthouse?action=revoke", { method: "POST" });
          stopPoll();
          setAuth("unauthorized");
        } catch (err) {
          setError(String(err));
        } finally {
          setBusy(false);
        }
      }

      async function startAuth() {
        setBusy(true);
        setError("");
        try {
          const res = await fetch("/lighthouse?action=auth-start", { method: "POST" });
          const data = await res.json();
          if (!data.flowId) throw new Error(data.error || "auth-start failed");
          if (data.authorizeUrl) {
            window.open(data.authorizeUrl, "_blank", "noopener,noreferrer");
          }

          const startedAt = Date.now();
          stopPoll();
          pollRef.current = setInterval(async () => {
            // 超时保护：5 分钟仍未完成则终止
            if (Date.now() - startedAt > 5 * 60 * 1000) {
              stopPoll();
              setBusy(false);
              setError(lookup("auth.timeout"));
              return;
            }
            try {
              const r = await fetch(
                "/lighthouse?action=auth-status&flowId=" + encodeURIComponent(data.flowId),
              );
              const s = await r.json();
              if (s.status === "authorized") {
                stopPoll();
                setBusy(false);
                await refresh();
              } else if (s.status === "error") {
                stopPoll();
                setBusy(false);
                setError(s.message || lookup("auth.fail"));
              }
            } catch {
              /* 单次轮询网络抖动忽略，下一轮重试 */
            }
          }, 2000);
        } catch (err) {
          setBusy(false);
          setError(String(err));
        }
      }

      return h(
        "div",
        {
          className: "lex-overlay",
          onClick: (e) => {
            if (e.target === e.currentTarget) props.onClose();
          },
        },
        h(
          "div",
          { className: "lex-drawer" },
          h("button", { className: "lex-close", onClick: () => { stopPoll(); props.onClose(); }, "aria-label": "close" }, "×"),
          h(
            "div",
            { className: "lex-head" },
            h(
              "div",
              null,
              h("div", { className: "lex-title" }, lookup("entry.title")),
              h("div", { className: "lex-sub" }, lookup("panel.subtitle")),
            ),
          ),
          auth === "authorized"
            ? h(
                "div",
                { className: "lex-body lex-post" },
                h(
                  "div",
                  { className: "lex-post-headline-row" },
                  h("div", { className: "lex-post-headline" }, lookup("post.headline")),
                  h(
                    "button",
                    { className: "lex-revoke-btn", onClick: () => void revokeAuth() },
                    lookup("post.revoke"),
                  ),
                ),
                h(
                  "div",
                  { className: "lex-feature-grid" },
                  ...lookup("auth.features").map((f) => h("span", { key: f }, f)),
                ),
                h("p", { className: "lex-post-hint" }, lookup("post.desc")),
                h("p", { className: "lex-post-examples" }, lookup("post.examples")),
              )
            : auth === "checking"
              ? h("div", { className: "lex-state" }, lookup("state.checking"))
              : h(
                  "div",
                  { className: "lex-auth" },
                  h("p", null, busy ? lookup("auth.waiting") : lookup("auth.desc")),
                  busy ? null : h(
                    "div",
                    { className: "lex-feature-grid" },
                    ...lookup("auth.features").map((f) => h("span", { key: f }, f)),
                  ),
                  h(
                    "button",
                    { className: "lex-btn lex-btn--primary", disabled: busy, onClick: () => void startAuth() },
                    busy ? "…" : lookup("auth.go"),
                  ),
                ),
          error ? h("p", { className: "lex-error" }, error) : null,
        ),
      );
    }

    // ---- 左侧入口（sidebar.footer.action 插槽，order 越小越靠上）----
    function ExpertEntry() {
      const [open, setOpen] = useState(false);
      return h(
        "div",
        { className: "lex-entry" },
        h(
          "button",
          { className: "lex-trigger", type: "button", onClick: () => setOpen(true) },
          h("span", { className: "lex-trigger__label" }, lookup("entry.title")),
        ),
        open ? h(ExpertPanel, { onClose: () => setOpen(false) }) : null,
      );
    }

    // ---- 工具结果卡片（骨架版：有 instances 渲卡片，否则 JSON 兜底）----
    function ToolView(props) {
      const value = props && (props.value ?? props.result ?? props.meta);
      const instances = value && value.instances;
      return h(
        "div",
        { className: "lex-tv" },
        Array.isArray(instances) && instances.length
          ? instances.map((x) => h(InstanceCard, { key: x.instanceId, instance: x }))
          : h("pre", { className: "lex-tv__raw" }, JSON.stringify(value ?? props, null, 2)),
      );
    }

    // ---- 插件装配 ----
    const inject = ["slots"];

    function apply(ctx) {
      const slots = ctx.slots;
      if (!slots) return;

      ctx.inject(["locale"], (c) => {
        if (!c.locale || typeof c.locale.register !== "function") return;
        c.effect(() => {
          try {
            return c.locale.register("lighthouse", { zh: ZH, en: EN });
          } catch {
            return () => {};
          }
        }, "lighthouse-locale");
      });

      ctx.effect(() => ensureCss(), "lighthouse-style");

      // 左侧入口：order 7（数值越小越靠上，按需调整与其他插件的相对位置）
      slots.inject("sidebar.footer.action", () =>
        registerSlot(
          slots,
          {
            name: "sidebar.footer.action",
            id: "lighthouse-expert",
            key: "lighthouse-expert",
            order: 7,
            label: () => lookup("entry.title"),
            locale: "lighthouse",
          },
          ExpertEntry,
        ),
      );

      // 对话里的工具卡片
      const toolKeys = [
        "lighthouse_list_instances",
        "lighthouse_describe_instance",
        "lighthouse_reboot_instances",
      ];
      for (const key of toolKeys) {
        slots.inject("tool.call.toolview", () =>
          registerSlot(
            slots,
            { name: "tool.call.toolview", key, locale: "lighthouse" },
            ToolView,
          ),
        );
      }
    }

    return { inject, apply };
  },
});
