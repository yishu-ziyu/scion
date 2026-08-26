# 交付文档：两个 e2e 缺口（018-O1 证据协议 + SW 重启场景）

> 写给接手完成的工程师。目标：两个任务各自可以独立复现、独立验收；
> 全部完成后 `pnpm e2e:action-agent` 不因 018-O1 挂掉，新增的 SW 重启场景可重复跑通。
> 事实与代码位置以 2026-08-26 工作树为准（本会话已交付：完成判定 baseline 修复、
> 侧栏 UX 升级、`pnpm reload:extension` 脚本；dist 已重建并在日常 Chrome reload 过）。

## 背景

- 持节是 MV3 扩展：service worker 内跑 TaskManager + 观察→决定→动作循环；侧栏是窗口。
- 测试现状：单元/组件两层很完整（chrome-extension 1119 项、sidepanel 323 项）；
  e2e 只有 `action-agent-e2e.mjs`（fixture 表单/iframe/媒体页 + 证据协议校验）。
- 缺口来源：任务清单第 12 项（会话总账），todo.md 有 018-O1 记录；SW 重启无 e2e 是本次调研结论。

## 环境与运行方式（两个任务通用）

```bash
# 方案 1（推荐）：Chrome for Testing
#   https://developer.chrome.com/docs/chrome-for-testing 下载，然后：
CHROME_PATH=/path/to/chrome-for-testing pnpm e2e:action-agent

# 方案 2：已有远程调试的 Chrome（本机日常 Chrome 已验证 9222 可连；扩展已 reload）
CDP_URL=http://127.0.0.1:9222 pnpm e2e:action-agent
#   connect 模式默认不重置用户数据；只要 fixture 页面，不动日常状态。

# 单任务收敛
EVAL_TASK_ID=018-O1 RUNS=1 pnpm -F chrome-extension e2e:action-agent
EVIDENCE_DIR=/tmp/e2e-evidence pnpm -F chrome-extension e2e:action-agent   # 保留证据 CSV/JSON
```

> 坑（已验证）：品牌版 Chrome ≥137 忽略 `--load-extension`；扩展改 build 后必须先
> `pnpm reload:extension`（或 chrome://extensions 手动 Reload），SW 不会自动刷新。
> 任意"改了没生效"先怀疑这个，再看代码。

---

## 任务 A：018-O1 `invalid_run / evidence_protocol` 修复

### 现象

- `pnpm e2e:action-agent`（默认 EVAL_TASK_ID=018-O1）整脚本 exit 1；
- 表单场景实际完成（fixture 断言 PASS、`completion-receipt` 出现），
  但证据行 `outcome=invalid_run`、`failure_class=evidence_protocol`；
- todo.md 旧记录：「表单已提交，侧栏完成收据协议；DEVLOG 已记」——`script` 后多次加字段，
  协议约束与收集器是否完全对上是未验证状态。

### 判定规则在哪（不许改它来“过测”）

- **门**：`chrome-extension/scripts/lib/eval-verification.mjs` → `actionScenarioPass(taskId, payload)`
  （约 275 行起）：
  - `actionOwnershipPass`：terminal/runtime/ui 三态一致 + runtime_task_id/round_id 三端一致 +
    visible_receipt_id === runtime_receipt_id + has_runtime_receipt + receipt 的 task/round 归属一致；
  - `o1EvidencePass`：receipt_count=1、completion_result_count=1、deliverable_count=1、
    page_evidence === 'Saved successfully'、scoped_card_count=1、submit_count=1、
    quiescence_ms ≥ 2500 且 confirmations ≥ 3、privacy_pass=true、final_deliverable='Saved successfully'。
- **收集器**：`action-agent-e2e.mjs` 的 `actionScenarioEvidence`/`buildActionVerificationEvidence`
  与 `scripts/lib/action-run-evidence.mjs` 的 `buildActionScenarioEvidence`；
  面板侧字段来自 `scopedCompletionSnapshot`（eval-verification.mjs）。
- **产品侧**（数据源）：`task-runtime-v1`（chrome.storage.local）+ 侧栏完成卡
  （`pages/side-panel/src/components/TaskStatusCard.tsx` completion-receipt 块/`deliverableAnswer`）。

### 诊断步骤（按顺序）

1. 复跑并把证据留下：`EVAL_TASK_ID=018-O1 EVIDENCE_DIR=/tmp/e2e-evidence pnpm -F chrome-extension e2e:action-agent`；
   产物含 runner evidence JSON + `writeActionTrace` 的 traces（`TRACE_DUMP_DIR` 可指定）。
2. 逐字段对照 `actionScenarioPass`：找到**第一个**为 false 的字段，就是断链点。
3. 三选一定位：产品没写/写错（storage 里没有）｜UI 没展示（面板读的是别的 round）｜runner 没收集（字段名/选择器不一致）。
   - storage 与面板对照技巧：在面板页 evaluate `chrome.storage.local.get('task-runtime-v1')`
     与 `document.querySelector('[data-testid=completion-receipt]')` 的 DOM 对照。
4. 特别注意（本会话近期改动，可能已让其消失或改变表现）：
   - `manager.ts` freezeCriteria 的 url/page_text baseline 语义调整（已完成）；
   - TaskStatusCard 新增 proof_required 的 produced 提升与 retry（新测试 id `produced-answer`/`proof-retry`）；
   - 若 UI 在 completion 与 proof_required 之间出现新状态，`scopedCompletionSnapshot` 的选择器可能失配。
5. 修法建议：产品行为错 → 修产品 + 对应单元测试；runner 收集错 → 修 runner；
   两者都有边界报错预期 → 在门里补充"可解释的失败原因"（贴证据），但不得让无证据通过。

### 验收（全满足）

- `EVAL_TASK_ID=018-O1 RUNS=1 pnpm -F chrome-extension e2e:action-agent` exit 0；
- 证据行 `outcome=verified_pass`、`failure_class=''`；
- 改动附带/更新相应单元测试（`scripts/__tests__/eval-*.test.mjs` 已有先例）；
- 不修改 `actionScenarioPass` 的通过条件（允许增加失败原因字段，不允许放宽）。

### 边界（不做）

- 不为过测把 `runtime_status`/`ui_status` 规约删除或放宽；
- connect 模式不带 `FORCE_RESET=1` 时不得清用户任务/记忆/聊天数据；
- 不引入新依赖；不破坏 `check:structure`。

---

## 任务 B：SW 重启后行为不变的 e2e 场景

### 现状与缺口

- MV3 SW ≈30s 空闲即挂；任务跨 SW 重启靠 `TaskManager.recover()`（
  `chrome-extension/src/background/task/manager.ts` 约 728 行）：
  paused 保持；waiting_user/confirm_execute 保持；running + 未决提交 → `waiting_user(commit_outcome_uncertain)`；
  其余 running → `interrupted`。
- 单测覆盖 recover 分类（manager.test.ts 若干条），但没有真机：
  - SW 被杀后任务对象/目标绑定是否一致；
  - 恢复后再跑是否重复提交（external_commit 只能一次）；
  - 面板是否如实反映恢复状态。
- 这正是"SW 正确性只靠单测间接覆盖"的缺口（调研结论第③条）。

### 设计（建议，可改）

新脚本 `chrome-extension/scripts/sw-restart-e2e.mjs`（复用 `action-agent-e2e.mjs` 的
launch/connect、fixture、helper；也可在 action-agent-e2e 里加 `EVAL_TASK_ID=019-SW` 分支，
优先独立脚本，便于 CI 单独调用）。步骤：

1. 起 fixture 表单页（`/form?run=...`），面板发
   `Fill Name with FIELD_SENTINEL_8472 and submit; success is Saved successfully.`；
2. 等第一次 `waitForExternalCommit` 前的稳定窗口（或首次 observe 完成后），
   用 CDP 杀掉扩展 SW：`browser.targets()` 找 `type()==='service_worker'` 且 url 含扩展 id，
   `close()`（puppeteer-core 24 支持；或 CDP `Target.closeTarget`）；
3. 等 2~3s，重新打开面板页（SW 由扩展页请求拉起）：
   - 断言任务仍在 storage（task-runtime-v1），`status` 符合 recover 预期；
   - 断言面板状态文案与 storage 一致（running→interrupted 显示"任务已中断，进度已经保存"；
     提交中断 → waiting_user + `commit_outcome_uncertain` 提示）；
4. 点继续/重发（或 follow_up），断言最终：`completion-receipt` 出现、
   **submissions 计数 === 1**（复用 `unexpectedCommitDetected` 逻辑）、receipt 唯一；
5. 每次跑完 `completeTaskSpace` 等价清理（关闭临时 profile）。

断言表（最小集）：

| 观察点 | 断言 |
|---|---|
| SW 被 kill | 面板重开后可再次服务（SW 重启成功） |
| 任务对象 | 同 taskId 存在，round/criteria/evidence 未被清空 |
| recover 分类 | 与 manager.recover 规则一致（running→interrupted；提交中断→waiting_user） |
| 恢复后执行 | 最终 completed，receipt id 唯一 |
| 重复提交 | submissions === 1 |

### 验收

- `pnpm -F chrome-extension e2e:sw-restart`（或并入既有命令矩阵）exit 0；
- 连跑 3 次稳定（`RUNS=3` 支持）；
- 失败时输出阶段名与当前 storage 快照（dumpPanel 类似物），便于定位；
- 不绕过 recover（不得在测试里直接改状态跳过恢复）。

### 边界（不做）

- 不做 SW 生命周期时长/挂起计时断言（30s 阈值行为属 Chromium，不测）；
- 不触碰真实用户数据（仅 fixture + 临时 profile；connect 模式亦只在 fixture 页上操作）。

---

## 参考

- `chrome-extension/scripts/action-agent-e2e.mjs`（01 行起为运行/证据基建）
- `chrome-extension/scripts/lib/eval-verification.mjs`（actionScenarioPass / scopedCompletionSnapshot）
- `chrome-extension/scripts/lib/action-run-evidence.mjs`（场景证据构建）
- `chrome-extension/scripts/lib/eval-trace-evidence.mjs`（trace 契约，022 Phase 0）
- `chrome-extension/src/background/task/manager.ts`（recover / persistVerifiedReceipt）
- `tasks/todo.md`（018-O1 条目更新后指向本文档）
- `scripts/reload-extension.mjs`（改 build 后必须 reload；`pnpm reload:extension`）

## 完成后的汇报方式

按仓库惯例：两个任务各自：改了什么（文件+行为）、怎么验证（命令+结论）、
哪些未验证（如实标注）。提交信息前缀 `fix(chijie)` / `feat(chijie)`。
