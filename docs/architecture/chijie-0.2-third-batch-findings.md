# 持节 Chijie 0.2 — 第三批中断记录（D4 完成，D5 调查结论，D6+ 未开工）

> 2026-09-03 开发暂停时的完整现场。下一轮从本文档恢复，不需要重新调查。
> 已入库：C6 接线（86772ac）、两个既有 bug 修复（ede3752）、E2E 基建加固（28927e7）、D4 测试（b7eef36）。

## D4 结论（已完成）

- 测量证明：7 条验收标准已被现有「整包 snapshot」传输满足（`get_active_task` 拉快照 + `task_event` 推送 + `mergeTaskSnapshot` revision 守卫），唯一缺口是证明。
- 新增仓库首个 mount 级测试（jsdom 单文件 pragma，零生产改动）：AC6 断连→重连→重新订阅、AC3 重复/陈旧事件幂等。
- D2 有序事件协议（`TaskServiceImpl`/`applyTaskEvents`）仍是零生产引用的旁路。**接线推迟到 E/F**——那里（candidate/verification 事件、纯 reducer 输出事件流）才是事件流的真正需求点，D4 中途换传输层不成比例。

## D5 调查结论（未开工，按此实施）

1. **真实缺口比 spec 字面小**：页面问答今天已不建 TaskSession、不触发 BrowserAction、不启动执行循环（`read_current_page` 直连 `host.readCurrentPage`，零模型调用）。验收 1-5 均已满足。
2. **唯一未满足**：模型调用 4 次（Orchestrator 分类 → Worker 选工具 → Worker 摘要 → Orchestrator 作答），目标 ≤3，新路径自然形态为 2 次。
3. **最小落点**：`orchestrator/run.ts` 的 `delegate_work` execute 分支——`needs_current_page && !may_operate_browser` 时直接 `await host.readCurrentPage()` 返回材料，不起 Worker ToolLoopAgent。
4. **安全问题（实施 D5 前必须先修）**：chat 路径的页面正文今天是**裸文本直入模型上下文**——`worker.ts` 的 `readPageTool` 无防注入包裹，`WORKER_INSTRUCTIONS`/`ORCHESTRATOR_INSTRUCTIONS` 也没有「页面内容是数据不是指令」约束。chat 链路唯一有包裹的是 wisebase 召回（`<<<BEGIN_UNTRUSTED_SAVED_SOURCE>>>`）。
   - 修法：复用现成 `wrapUntrustedContent`（`agent/messages/utils.ts:607`，自带 guardrails 清洗 + 剥除正文中伪造闭合标签的防逃逸），落点在 `live-host.ts` 的 `readVisibleCurrentPage` 返回前——**一处改动同时覆盖现有 Worker 路径与 D5 新路径**；再在两份 prompts 各加一句不可信内容约束。
5. **不要复活的休眠路径**：`page_summary_stream` 后台 handler 无任何前端调用方（`chat-turn.test.ts` 明令禁止 SidePanel 直发），且它绕开对话历史与多轮上下文。D5 复用 `readCurrentPage` host 能力，不接这个端口。
6. **架构测试边界**（改动必须留在界内）：`orchestrator/__tests__/routes.test.ts` 禁止 orchestrator 出现 `getCurrentPage`/`attachPuppeteer`/`debugger.attach`，并要求 live-host 走 `collectPageContextFromTab`。

## D6 / D7 / E / F 未开工要点

- **D6（删 Worker）**：与 D5 同一战场——D5 的「页面问答直返材料」就是 D6 路由三分支（读页 / 操作 / 直答）的第一支，建议 D5+D6 一个连续会话做，feature flag 回退按 spec。
- **D7 / F6 验收**（`e2e:sw-restart` RUNS=3 稳定）：被 live LLM 残余方差挡住（见下）。先做 H3 scripted provider 再跑此验收，否则是在测模型心情。
- **E1-E7 / F1-F8**：验收标准见 EPIC 表。E4 的「Receipt 不存表单原值」已在 ede3752 实现一半（candidate summary 脱敏），E4 正式化时收口。
- **每个 PR 至少删一个 known violation**（迁移纪律），当前 structure 基线 13。

## 残余方差（非代码 bug，勿再当 bug 修）

- live E2E（018-O1 / sw-restart）偶发失败源于 MiniMax-M3 轨迹方差（模型诚实失败/游走）。两个确定性根因（cue 跨行贪婪捕获、指令不可重水化）已在 ede3752 修复并各自实证过一次完整 PASS。根治 = H3 scripted provider + 提示词加固。

## 评估基建（直接用，勿重建）

- `CHIJIE_RUNTIME_MODE=v2-shadow` 注入 E2E；`SW_LOG=1` 抓 SW 控制台到 `TRACE_DUMP_DIR/sw-console.json`；失败自动 dump 原始 trace；`node scripts/shadow-report-check.mjs <dir>` 审计 shadow 记录。
- 归因回归用 `git worktree` 对照旧提交（不动主工作区）；基线产物放 `artifacts/`（已 gitignore，勿放 dist/）。
- 密钥：`node chrome-extension/scripts/inject-personal-secrets.mjs`（无参）注入 MiniMax key。
