# 08 — Dynamic page action binding（M3 可插队 · 可信执行）

**What to build:** 页面在 observe→act 之间变化后，**不得执行**基于旧观察的目标动作（尤其 `index` / element 点击与输入）；应 **重新观察 + 有限重试**（或明确 blocked / replan，且 **不** 当成功完成）。`navigate` / 无页面目标动作不被误伤；现有 `ActionDispatcher` 调用方与 schema 保持兼容。对齐 `docs/product/009`「动态页面动作强绑定」与 product/007 精神。

**Why now:** M3 飞书真实旅程的可信度前置；非新功能。Slice A QA 残留：模型常只带 DOM `index`、不带 `pageRevision`/`target_digest` 时，dispatcher **不能** 拦住 observe→act 漂移。

**Priority:** M3 期间可插队（可与 06/07 并行；与真站提交安全同级的可信修复）
**Blocked by:** 无硬块（S2 已有）；建议在动真站 external commit 前合入
**Status:** verified-local · P4 PASS · real-site regression pending
**Seams:** S2（`ActionDispatcher` / `page-state`）为主；S4 观察 digest 为辅

---

### 用户结果

| 当… | 应看到 |
|-----|--------|
| 列表/DOM 刷新后，旧 index 指向错误控件 | **不** 误点；任务重试或人话失败（非「已完成」） |
| 目标仍在、仅轻微重排且 digest 仍可对上 | 有限重试后动作仍可成功 |
| 只 navigate / wait / done / 无 element 目标 | 行为与现网一致，不无故失败 |
| 批准后提交前目标变了 | 延续现有：不执行，要求 replan（已有路径不得回退） |

### 范围

- 绑定面：依赖页面目标的 mutate 动作（至少 `click_element`、`input_text`、带 index 的选择/滚动目标；与 `control_media` 的 digest 绑定一致精神）
- 策略：执行前用 **当前观察** 校验目标；漂移 → 不执行旧目标 → re-observe → **有限重试**（次数写死、小）→ 仍失败则 `blocked`/`didnt`（或已有 replan 信号），**禁止** false complete
- 可选 claim：`pageRevision` / `target_digest`（snake/camel 已由 `readClaimedState` 支持）继续有效；**未 claim 时** 也不得仅凭陈旧 index 盲点
- 兼容：不改破坏性 schema 必填；现有无 revision 调用路径可跑，安全语义收紧而非 API 换代

### 非目标

- 不做飞书/B 站业务切片本体（仍 06/07）
- 不改审批产品策略、不重做侧栏 UI、不扩 Skill/记忆
- 不要求模型每次必填 revision（系统侧保证）
- 不追求全域 SPA 完美绑定或加密级「第一格」证明

### 验收

- [x] 有页面目标 + 观察后目标 digest/revision 变化 → **execute 0 次**（或仅在 re-observe 对齐后执行新绑定）
- [x] 漂移路径有 **有限 re-observe 重试**；耗尽后失败可见，**无** completion receipt / 非 verified done
- [x] `go_to_url` / `wait` / `done` / 无 target 的 read·navigate 类：**不** 因本票回归失败
- [x] 已有 approval 后 target 变化拒绝路径仍绿；旧测试（approval、stale claim、effect policy）保持兼容
- [x] 最小单测覆盖下列（`action-dispatcher.test.ts` + `observe-act-loop.test.ts`）

### 最小测试

1. **stale index/digest：** before 观察 digest=A，execute 前变为 B → 不调用 execute（或仅对齐后调用）
2. **limited retry：** 首次漂移、第二次观察恢复一致 → 最终可成功，重试次数有上界
3. **no-target safe：** navigate/wait/done 无 element 绑定要求，行为不变
4. **compat：** 无 `pageRevision` 的既有 rawArgs 仍可 dispatch；显式 stale claim 仍 reject

### 风险

| 风险 | 缓解 |
|------|------|
| 过严绑定 → 合法点击频繁 blocked | 有限重试；仅 element 目标动作；digest 优先于整页 revision 抖动（与审批 recheck 注释一致） |
| 重试掩盖真失败 | 上界小；耗尽必须失败分类，不 silent succeed |
| 与 06 真站并发 | 本票合入降低误提交面；不替代 G3 证据 |

**Out of tickets index until P0 merges graph:** 不更新 `00-INDEX.md`（本派工仅建本文件）。

### 2026-07-15 本地证据

- Dispatcher：49/49；observe-act loop：7/7；S2 journey 回归：62/62。
- Prettier、ESLint、`git diff --check` 通过。
- 项目全量 type-check 仍被未触碰文件中的 6 个既有错误阻断；本票文件无新增类型错误。
- P4 独立复跑：`action-dispatcher.test.ts` 49/49、`observe-act-loop.test.ts` 7/7，`git diff --check` 通过；结论 PASS。
- P4 核对：旧目标漂移 execute=0，稳定目标 execute=1，无目标动作不额外重检，loop 有限重试，审批路径无回退。
- 尚未提交；尚缺真实 Chrome 动态 DOM 回归，因此不得写 landed 或关闭真实站差距。
