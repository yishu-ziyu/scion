# 持节 Chijie 0.2 — 迁移基线（EPIC A1）

> 冻结 0.2 迁移前的既有事实：每个流程的入口、输入、预期状态、预期回执与真实测试命令。
> 本文档中出现的每个仓库路径都经核验真实存在（2026-09-02，main 分支）。
> 既有债务：`pnpm type-check` 33 个错误、`pnpm check:structure` 13 个错误为基线红色，本批不修。

## 测试分层定义

- **Fixture E2E**：本地 fixture 页 + 启动 Chrome for Testing 加载 `./dist` 扩展，puppeteer-core 驱动。命令见各节。
- **Unit（vitest）**：`pnpm -F chrome-extension test`；单文件：`pnpm -F chrome-extension exec vitest run <测试文件路径>`。
- **Live Canary**：需要真实 Provider key 的 eval 矩阵（`pnpm eval:matrix`，默认 MiniMax）。
- **手工**：需要真人判断或真实站点登录态，无自动化入口。

## 旧架构关键路径（真实文件）

| 角色 | 路径 |
|------|------|
| 任务循环 / 状态机 | `chrome-extension/src/background/task/manager.ts` |
| 任务契约类型 | `chrome-extension/src/background/task/contracts.ts` |
| 动作分发 | `chrome-extension/src/background/task/action-dispatcher.ts` |
| 完成判定 | `chrome-extension/src/background/task/completion.ts` |
| candidate 验证引擎 | `chrome-extension/src/background/task/verification-engine.ts` |
| 结果产出与回执 | `chrome-extension/src/background/task/task-result.ts` |
| 表单值证据 | `chrome-extension/src/background/task/form-value-evidence.ts` |
| 页面状态门 | `chrome-extension/src/background/task/page-state.ts` |
| 下载状态探针 | `chrome-extension/src/background/task/download-state.ts` |
| 媒体参数解析 | `chrome-extension/src/background/task/media.ts` |
| 结构化 trace 存储 | `chrome-extension/src/background/task/trace.ts` |
| 循环阶段 attempt | `chrome-extension/src/background/task/loop-phase-attempt.ts` |
| 提交恢复 | `chrome-extension/src/background/task/__tests__/commit-recovery.test.ts` |
| 控制 LLM 后端 | `chrome-extension/src/background/agent/backends/control-llm.ts` |
| observe-act 循环 | `chrome-extension/src/background/agent/backends/observe-act-loop.ts` |
| 重试策略 | `chrome-extension/src/background/agent/retry-policy.ts` |
| 内建技能 | `chrome-extension/src/background/agent/skills/builtin/` |
| 浏览器内核 | `chrome-extension/src/background/browser/kernel/browser-kernel.ts` |
| CDP 会话 | `chrome-extension/src/background/browser/cdp/session.ts` |
| 页面可用性判定 | `chrome-extension/src/background/browser/page-availability.ts` |
| 搜索结果 | `chrome-extension/src/background/browser/search-results.ts` |
| debugger detach | `chrome-extension/src/background/runtime/debugger-detach.ts` |
| SW keep-alive | `chrome-extension/src/background/runtime/task-keep-alive.ts` |
| 扩展 manifest | `chrome-extension/manifest.js` |
| E2E 运行器 | `chrome-extension/scripts/action-agent-e2e.mjs`、`chrome-extension/scripts/sw-restart-e2e.mjs`、`chrome-extension/scripts/user-journey-e2e.mjs` |
| eval 矩阵 | `scripts/eval-matrix.mjs` |

---

## 1. 当前页面问答

- **入口**：侧栏输入「这篇页面讲了什么」类问题；`chrome-extension/src/background/agent/skills/builtin/understanding-answer.ts` 路由到 `chrome-extension/src/background/browser/sites/understanding-answer.ts`。
- **输入**：当前绑定 tab 的页面文本（observation 产物）。
- **预期状态**：任务 `completed`；答案作为 deliverable 进入回执。
- **预期回执**：completion receipt 含答案文本；trace 记录 observe→act 跨度。
- **测试命令**：`pnpm -F chrome-extension exec vitest run src/background/browser/sites/__tests__/understanding-answer.test.ts`；journey 探针 `node chrome-extension/scripts/user-journey-e2e.mjs`（需 CHROME_PATH）。
- **分层**：Unit + Fixture E2E（user-journey）。

## 2. 页面标题读取

- **入口**：任务观察阶段读取 `document.title`；`chrome-extension/src/background/browser/kernel/observation.ts`、`chrome-extension/src/background/browser/kernel/visible-text.ts`。
- **输入**：任意 fixture 页（如 `chrome-extension/test/fixtures/products.html`）。
- **预期状态**：标题出现在 observation 快照与 trace span。
- **预期回执**：无独立回执；标题进入任务上下文供后续验证。
- **测试命令**：`pnpm -F chrome-extension exec vitest run src/background/browser/kernel/__tests__/observation.test.ts`。
- **分层**：Unit。

## 3. 单字段填表并提交

- **入口**：侧栏任务「把 Name 填为 X 并提交」；skill `chrome-extension/src/background/agent/skills/builtin/form-fill-submit.ts`。
- **输入**：`chrome-extension/test/fixtures/form.html`（本地 http 服务 + POST /submit）。
- **预期状态**：任务 `completed`；页面出现 `#saved`（"Saved successfully"）。
- **预期回执**：唯一 receipt ID；`completion_result` 含页面证据 "Saved successfully"；外部提交计数 =1。
- **测试命令**：`pnpm e2e:action-agent`（018-O1 form 场景）；单元 `pnpm -F chrome-extension exec vitest run src/background/task/__tests__/form-journey.test.ts`。
- **分层**：Fixture E2E。

## 4. 多字段连续填写后提交

- **入口**：同上，多字段指令；`chrome-extension/src/background/browser/kernel/fill-text.ts`、`chrome-extension/src/background/browser/kernel/form-fields.ts`。
- **输入**：多字段 fixture（现有 `chrome-extension/test/fixtures/form.html` 仅单字段；多字段连续填写由 `chrome-extension/test/fixtures/duplicate-labels/index.html` 补充歧义场景）。
- **预期状态**：每个字段值先经 `chrome-extension/src/background/task/form-value-evidence.ts` 摘要，再提交。
- **预期回执**：提交后页面证据 + 每字段 verified step record（`chrome-extension/src/background/task/verified-step-records.ts`）。
- **测试命令**：`pnpm -F chrome-extension exec vitest run src/background/task/__tests__/form-value-evidence.test.ts`；`pnpm -F chrome-extension exec vitest run src/background/browser/kernel/__tests__/fill-text.test.ts`。
- **分层**：Unit（E2E 待 0.2 接线）。

## 5. 跨源 iframe 填写

- **入口**：CDP `Runtime.evaluate` + DOM snapshot 穿透 iframe；`chrome-extension/src/background/browser/cdp/collect.ts`、`chrome-extension/src/background/browser/cdp/session.ts`。
- **输入**：`chrome-extension/test/fixtures/iframe-shadow.html`（含 iframe `chrome-extension/test/fixtures/iframe-shadow-frame.html` 与 shadow root）。
- **预期状态**：目标控件在合并 DOM 树中可定位（`chrome-extension/src/background/browser/cdp/merge.ts`）。
- **预期回执**：点击/填写 attempt 的 effect 记录为生效；oracle 在 frame 文档内。
- **测试命令**：`pnpm -F chrome-extension exec vitest run src/background/browser/cdp/__tests__/iframe-shadow-fixture.ts`（fixture 构造测试）；`pnpm -F chrome-extension exec vitest run src/background/browser/cdp/__tests__/build-dom-tree-source.test.ts`。
- **分层**：Unit（真实跨源 iframe 需 Live/手工验证，见 0.2 后续批次）。

## 6. 打开指定位置的搜索结果

- **入口**：skill `chrome-extension/src/background/agent/skills/builtin/search-and-open.ts`；导航后端 `chrome-extension/src/background/agent/backends/lookup-navigation.ts`。
- **输入**：搜索词 + 位置序号；结果页由 `chrome-extension/src/background/browser/search-results.ts` 解析。
- **预期状态**：目标结果在新/绑定 tab 打开且 tab 归属正确（`chrome-extension/src/background/browser/task-tab-group.ts`）。
- **预期回执**：deliverable 含打开页面的 URL/标题；wrong_tab 为 0。
- **测试命令**：`pnpm -F chrome-extension exec vitest run src/background/browser/__tests__/search-results.test.ts`；站点技能单测 `pnpm -F chrome-extension exec vitest run src/background/browser/sites/__tests__/public-shortcuts.test.ts`。
- **分层**：Unit（真实搜索引擎为 Live Canary：`pnpm eval:matrix`）。

## 7. 媒体播放与暂停

- **入口**：skill `chrome-extension/src/background/agent/skills/builtin/media-control.ts`；参数解析 `chrome-extension/src/background/task/media.ts`。
- **输入**：`chrome-extension/test/fixtures/media.html`（loop 音频，由 action-agent-e2e 内联 WAV 服务）。
- **预期状态**：play 后 `paused===false`；pause 后 `paused===true`。
- **预期回执**：媒体场景 scenario evidence 记录 paused 状态；receipt 完成。
- **测试命令**：`pnpm e2e:action-agent`（media-play/media-pause 场景）；`pnpm -F chrome-extension exec vitest run src/background/browser/__tests__/media.test.ts`、`pnpm -F chrome-extension exec vitest run src/background/task/__tests__/media-journey.test.ts`。
- **分层**：Fixture E2E + Unit。

## 8. 多标签页切换

- **入口**：kernel `chrome-extension/src/background/browser/kernel/find-tab.ts`；tab 分组 `chrome-extension/src/background/browser/task-tab-group.ts`。
- **输入**：多 tab 场景（e2e 内 target/panel 多页）。
- **预期状态**：任务只操作绑定 tab；`wrong_tab` 检测（`chrome-extension/scripts/lib/eval-verification.mjs` 的 `tabProvenanceWrongTab`）为假。
- **预期回执**：trace `tab_events` 样本与 bound_tab 一致。
- **测试命令**：`pnpm -F chrome-extension exec vitest run src/background/browser/kernel/__tests__/find-tab.test.ts`、`pnpm -F chrome-extension exec vitest run src/background/browser/__tests__/task-tab-group.test.ts`；多源 fixture `chrome-extension/test/fixtures/multi-source/index.html`（本批新增）。
- **分层**：Unit + Fixture E2E（trace 断言在 action-agent-e2e 的 tab_checks）。

## 9. 下载开始与完成

- **入口**：完成判据 `download_state`；探针 `chrome-extension/src/background/task/download-state.ts`（none/started/finished）。
- **输入**：下载 fixture `chrome-extension/test/fixtures/download/index.html`（本批新增，data: URL 触发）；真实下载为手工。
- **预期状态**：冻结时刻后的 item 才计数；finished 前不标绿。
- **预期回执**：criteria 通过记录 download_state=finished。
- **测试命令**：`pnpm -F chrome-extension exec vitest run src/background/task/__tests__/download-state.test.ts`。
- **分层**：Unit + 手工（真实站点下载）。

## 10. 登录墙

- **入口**：任务遇到登录页时 `chrome-extension/src/background/task/manager.ts` 置 `waiting_user`（takeover 路径，manager.ts `case 'takeover'`）。
- **输入**：fixture `chrome-extension/test/fixtures/login-wall/index.html`（本批新增；oracle `authenticated`）。
- **预期状态**：未登录时不得标 completed；任务等待用户。
- **预期回执**：无完成回执；状态卡显示等待原因。
- **测试命令**：`pnpm -F chrome-extension exec vitest run src/background/task/__tests__/manager.test.ts`（waiting_user 状态机）；fixture 静态核验 `pnpm baseline:report`。
- **分层**：Fixture（本批仅静态 oracle）+ 手工（真实登录墙）。

## 11. 验证码

- **入口**：同登录墙等待路径；guardrails `chrome-extension/src/background/services/guardrails/index.ts` 不做绕过。
- **输入**：fixture `chrome-extension/test/fixtures/captcha-wall/index.html`（本批新增；oracle `captchaSolved`）。
- **预期状态**：agent 不得自动破解；任务等待用户接管。
- **预期回执**：无完成回执直到人工通过。
- **测试命令**：fixture 静态核验 `pnpm baseline:report`；真实站点为手工。
- **分层**：Fixture（静态）+ 手工。

## 12. 404 或页面不可用

- **入口**：`chrome-extension/src/background/browser/page-availability.ts` 判定不可用；`chrome-extension/src/background/task/page-state.ts` 的 `allowsVerifiedComplete` 阻止标绿。
- **输入**：`node chrome-extension/scripts/user-journey-e2e.mjs` 内置 `/gone` 404 路由；fixture `chrome-extension/test/fixtures/unavailable-page/index.html`（本批新增，oracle `available:false`）。
- **预期状态**：任务 failed/waiting，绝不 completed。
- **预期回执**：无 receipt；失败类别记录。
- **测试命令**：`pnpm -F chrome-extension exec vitest run src/background/browser/__tests__/page-availability.test.ts`、`pnpm -F chrome-extension exec vitest run src/background/task/__tests__/page-state.test.ts`；`node chrome-extension/scripts/user-journey-e2e.mjs`。
- **分层**：Unit + Fixture E2E。

## 13. Service Worker 重启

- **入口**：e2e 杀掉扩展 SW 后重开面板；恢复逻辑 `chrome-extension/src/background/task/manager.ts`（`recover`/`StaleTaskRoundError` in `chrome-extension/src/background/task/contracts.ts`）；keep-alive `chrome-extension/src/background/runtime/task-keep-alive.ts`。
- **输入**：`chrome-extension/test/fixtures/form.html` 任务中途 kill SW。
- **预期状态**：任务不丢失、不重复提交（in-flight external_commit 单次落地）。
- **预期回执**：receipt 唯一；提交计数 =1。
- **测试命令**：`pnpm e2e:sw-restart`（即 `pnpm -F chrome-extension e2e:sw-restart`，见 `chrome-extension/scripts/sw-restart-e2e.mjs`）；`pnpm -F chrome-extension exec vitest run src/background/runtime/__tests__/task-keep-alive.test.ts`。
- **分层**：Fixture E2E。

## 14. debugger detach

- **入口**：`chrome-extension/src/background/runtime/debugger-detach.ts`；CDP 会话 `chrome-extension/src/background/browser/cdp/session.ts`。
- **输入**：attach 后用户关 DevTools / 任务结束 detach。
- **预期状态**：detach 后动作失败被分类为可重试（`chrome-extension/src/background/agent/retry-policy.ts`）。
- **预期回执**：重新 attach 后任务继续；trace 记录。
- **测试命令**：`pnpm -F chrome-extension exec vitest run src/background/runtime/__tests__/debugger-detach.test.ts`。
- **分层**：Unit（真实 detach 抖动为手工）。

## 15. 用户接管

- **入口**：`chrome-extension/src/background/task/manager.ts` 的 `takeover` 命令（`case 'takeover'` → `private async takeover`）。
- **输入**：用户在面板点击接管。
- **预期状态**：任务暂停自动动作；tab 前置（manager.ts「Bring the task tab to the front (跟随 on, or 接管)」）。
- **预期回执**：CommandAck；恢复后继续。
- **测试命令**：`pnpm -F chrome-extension exec vitest run src/background/task/__tests__/manager.test.ts`。
- **分层**：Unit + 手工。

## 16. Provider 401/429/451/超时

- **入口**：`chrome-extension/src/background/agent/backends/control-llm.ts` 调用失败 → `chrome-extension/src/background/agent/retry-policy.ts`（`unauthorized|forbidden` → no_retry；其余 retry；`max failures` → escalate）。
- **输入**：坏 key（401）、限流（429）、封锁（451）、超时。
- **预期状态**：401/451 不无限重试；429/超时按预算重试，耗尽 escalate。
- **预期回执**：executor 启动错误分类 `chrome-extension/src/background/task/executor-start-error.ts`；trace llm span 失败。
- **测试命令**：`pnpm -F chrome-extension exec vitest run src/background/agent/__tests__/retry-policy.test.ts`、`pnpm -F chrome-extension exec vitest run src/background/task/__tests__/executor-start-error.test.ts`；真实 Provider 为 Live Canary `pnpm eval:matrix`。
- **分层**：Unit + Live Canary。

## 17. candidate complete 但验证失败

- **入口**：模型提出 complete → `chrome-extension/src/background/task/verification-engine.ts`（`verifyCandidateComplete`）核对 criteria。
- **输入**：criteria 未满足的页面（如 `chrome-extension/test/fixtures/no-effect-button/index.html` 本批新增：点击无 DOM/URL 变化）。
- **预期状态**：candidate 被拒，任务继续或诚实失败；不得 false-success。
- **预期回执**：无 receipt；attempt finding 记录验证失败。
- **测试命令**：`pnpm -F chrome-extension exec vitest run src/background/task/__tests__/verification-engine.test.ts`、`pnpm -F chrome-extension exec vitest run src/background/task/__tests__/022-verify-artifact-gates.test.ts`；false_complete 指标在 `chrome-extension/scripts/action-agent-e2e.mjs` 的 matrix_row。
- **分层**：Unit + Fixture E2E。

## 18. candidate complete 但证据不足

- **入口**：`chrome-extension/src/background/task/completion.ts`（`checkCompletion`）+ `chrome-extension/src/background/task/form-value-evidence.ts`（值证据缺失即不过）。
- **输入**：表单值未回读、无页面证据的完成请求。
- **预期状态**：等待/拒绝完成；`commit_outcome_uncertain` 等待原因（manager.ts）。
- **预期回执**：无 receipt；恢复提交后单一回执（`chrome-extension/src/background/task/__tests__/commit-recovery.integration.test.ts`）。
- **测试命令**：`pnpm -F chrome-extension exec vitest run src/background/task/__tests__/completion.test.ts`、`pnpm -F chrome-extension exec vitest run src/background/task/__tests__/commit-recovery.test.ts`、`pnpm -F chrome-extension exec vitest run src/background/task/__tests__/task-result.test.ts`。
- **分层**：Unit。

---

## 环境快照与量化基线（本批新增命令）

- `pnpm baseline:env` → `scripts/print-runtime-environment.mjs`：JSON 环境指纹（gitSha/node/pnpm/版本/chromePath 脱敏/protocolVersion:"legacy"）。
- `pnpm baseline:report` → `scripts/baseline-report.mjs`：聚合 `EVIDENCE_DIR` 的 verification JSON（由 `chrome-extension/scripts/action-agent-e2e.mjs` 写出，见其 `writeRunnerEvidence`）与 fixture 静态 oracle（`chrome-extension/test/fixtures/*/fixture.json`），输出 JSON+Markdown 到 `dist/baseline/`；schema 为 `schemas/baseline-report.schema.json`。无数据时输出全 0 合法报告。
