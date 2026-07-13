# Scope challenge

## Candidate requirements

| Requirement | Owner | Keep / Cut / Defer | Reason |
|---|---|---|---|
| 在真实 Chrome 登录态中完成完整多步网页任务 | Owner | Keep | 核心用户价值 |
| 同一会话的后续指令绑定原任务、标签页和对象 | Owner | Keep | 支持“暂停它”“继续填写”等连续控制 |
| 用页面结果验证完成，而不是只相信模型自报成功 | Product/Engineering | Keep | “做完”与“尝试过”的分界 |
| 提交、购买、删除、发消息等高影响动作的审批闸门 | Product/Engineering | Keep | 不能用通用性换取不可控副作用 |
| 通用浏览器动作原语，不为飞书或 B 站写一次性专用流程 | Product/Engineering | Keep | 最小实现同时保留跨网站扩展性 |
| 将成功任务保存为本地可复用 Skill | Owner | Keep | Owner 已确认首轮需要最小本地 Skill，形成可扩展能力闭环 |
| Skill 社区、分享与市场 | Product | Defer | 先证明本地 Skill 有复用价值 |
| 并行运行多个 Agent | Product | Defer | 首周期先保证单任务可靠完成 |
| 独立 Chromium 浏览器 | Product | Cut | OpenAI Atlas 已转向桌面应用和 Chrome 扩展；现有扩展路径更轻 |
| 企业账号、组织、RBAC、计费 | Product | Cut | 不属于首个单用户闭环 |
| 原生桌面应用控制 | Product | Cut | 本周期执行边界限定在浏览器页面 |

## Must-ship this cycle

- Engineering DRI: 完成一个跨页面、有输入/点击/状态变化的真实浏览器任务；Owner 负责真实浏览器验收。
- Engineering DRI: 完成后可用后续自然语言继续控制同一页面对象；Owner 确认指代符合预期。
- Engineering DRI: 成功任务可保存为本地 Skill，并用新的输入再次运行；Owner 验证实际复用价值。
- Product/Engineering DRI: 系统必须提供可检查的完成证据，并对高影响动作停在审批点；Owner 只负责批准或拒绝真实外部提交。

## Deleted or deferred

- 不造新浏览器，不做社区，不做企业后台，不做桌面全局控制，不先追求并行 Agent。

## Explicit non-goals

- 不把“打开网页”计为任务完成。
- 不用飞书、B 站专用硬编码伪装成通用 Agent。
- 不以 Planner 输出 `done=true` 作为唯一完成证据。
