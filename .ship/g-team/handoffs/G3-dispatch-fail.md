HANDOFF|task=g3-dispatch-fail|status=investigated|files=none (analysis only)|tests=n/a|unverified=no service-worker log capture on v3 run; no bare complex retry

# 动作调度失败 = `dispatch_failed` (HB 02:13 residual)

## Dual note

### 1) Root cause (code path, not "random flake")

侧栏文案 `chat_task_fail_dispatch` ← `failureCategory === 'dispatch_failed'`。

| 层 | 行为 |
|----|------|
| `observe-act-loop` | `act()` **throw** → failures++；耗尽 `maxFailures` → `{kind:failed, category:'dispatch_failed'}` |
| 对比 | `act()` **return `{error}`** → 同类预算但 category=`action_failed` |
| `control-llm` act | `hooks.dispatchAction` 出错时 **`throw error` 原样抛出**（不降级为 `{error}`） |

长复杂任务（B站→飞书）上 throw 的主来源：

1. **`StaleTaskRoundError`**（`manager.executorHooks.dispatchAction`）  
   条件：`task.status !== 'running'` 或 `currentRoundId !== roundId`。  
   长 run 中一旦进入 `waiting_approval` / `waiting_user`（含 `commit_outcome_uncertain`），loop 若仍继续 decide→act，下一次 dispatch **必 throw**。

2. **`ActionDispatcher` catch 后 rethrow**（`action-dispatcher.ts` ~249–252）  
   `action.executeParsed` 抛错 → 写 attempt `uncertain`/`blocked` → **再 throw**。  
   `persistAttempt(uncertain)` 会把任务打成 `waiting_user` + stopDriver；throw 仍回到 loop → 计 `dispatch_failed` 预算，而不是干净地停在等人态。

3. **`persistAttempt`「Task is not running」**（executing 写入时状态已不是 running）  
   竞态：status 已切 waiting_*，仍有 in-flight dispatch 写 executing。

**与 overnight 现象对齐：**  
attempt1 selector_miss；CDP 已写飞书清单；agent v3 再跑后侧栏 **动作调度失败** — 符合「多步/批准/不确定提交后状态离开 running，loop 仍 throw 累积 → dispatch_failed」，不是缺 selector 本身。

**非根因：** bilibili 标题选择器（另刀 g3-bili-selectors）；引擎启动失败（setup 分类）。

### 2) Smallest fix（推荐顺序）vs Blocker

**最小修（P0，可单测，不需真站重跑）：**

1. **`control-llm` act：catch 后 return `{ error }`，禁止 rethrow**  
   - `StaleTaskRoundError` → 明确 error token（或 fatal cancel），避免伪装成「调度失败」。  
   - 其它 Error → `{ error: message }` → 走 `action_failed` 预算，或识别后 `waiting_user`。

2. **`ActionDispatcher`：external_commit 路径 throw 后改为 return `ActionResult({error})` + uncertain**  
   让 `waiting_user` 成为唯一终态，loop 不再吃 throw。

3. **（可选加固）`observe-act-loop`：act throw 若 message/name=StaleTaskRound → 直接 `cancelled` 或软停**，不累积为 dispatch_failed。

**不要做：** 裸重试 complex B站→飞书 agent（Owner 已 PRODUCT_PASS 页内容）。

**Blocker（若要 G4 verified agent 全链路）：**  
需 SW 日志/一次受控单测复现 Stale+uncertain 链；无日志时 v3 现场根因只能到「机制级」不能钉到单次 throw 的精确 action 名。

## Suggested test (when implementing)

```text
// manager/control-llm unit: task forced waiting_user → dispatchAction throws Stale
// → outcome must NOT be failureCategory dispatch_failed (prefer soft error / cancelled / keep waiting_user)
```

## Owner / G1 next

- Product residual: agent verified path still open; page content PASS.  
- Eng: implement P0 #1+#2 when scheduling next G3 code slice; no overnight bare retry.
