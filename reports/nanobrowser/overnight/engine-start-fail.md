# Engine start fail + waiting_user without confirm — root cause

Date: 2026-07-16 (overnight G3)  
Repo: `projects/chijie-browser`

## Observed (owner / side-panel)

1. 任务卡文案 **「任务引擎启动失败…」**
2. 状态 **waiting_user** + `waitReason=commit_outcome_uncertain`，且 **没有** `criterion-confirm` 按钮

These are **two separate surfaces**, not one bug with two symptoms.

---

## A) 「任务引擎启动失败」= `failureCategory=executor_start_failed`

### Code path

1. `TaskManager.runCurrentRound` → `deps.createExecutor(...)`  
2. Default backend is **control** → `createLlmControlDriver`  
3. On throw, catch sets `status=failed` + `round.failureCategory`  
4. Side-panel `failureCategoryHint('executor_start_failed')` → i18n `chat_task_fail_start` → **任务引擎启动失败**

### Root cause (mislabel)

Setup errors were thrown as:

```ts
throw new Error(t('bg_setup_noApiKeys')) // message = 中文「请先在设置页面中完成 API 密钥的设置。」
```

Old classifier only matched **English tokens**:

```ts
/noApiKeys|noNavigator|noProvider|setup/i.test(error.message)
```

Chinese `bg_setup_*` bodies **never match** → always `executor_start_failed` even when the real problem is missing key / model / provider (should be `setup_failed` → **模型或密钥未就绪**).

### Common real triggers

| Trigger | Result before fix |
|---------|-------------------|
| Storage empty of providers (bootstrap skipped empty key, or stale dist without inject) | Chinese noApiKeys → **engine start fail** (wrong label) |
| Navigator model missing | Chinese noNavigator → same |
| Provider id missing | Chinese noProvider → same |
| True crash inside createChatModel / unrelated throw | legitimately `executor_start_failed` |

`secrets.local.ts` is present in the tree; if **loaded** `dist/` was built without `inject:personal` / `pnpm build`, runtime key may still be empty.

### Fix shipped (minimal)

| File | Change |
|------|--------|
| `task/executor-start-error.ts` | `markSetupError` + `classifyCreateExecutorError` (name + zh body + machine tokens) |
| `task/manager.ts` | use classifier in createExecutor catch |
| `backends/control-llm.ts` / `nano.ts` | setup throws via `markSetupError` (`Error.name=setup_failed`) |
| tests | `executor-start-error.test.ts` + manager `setup_failed` case |

### Commands (exit 0)

```bash
pnpm -F chrome-extension test -- src/background/task/__tests__/executor-start-error.test.ts  # 4
pnpm -F chrome-extension test -- src/background/task/__tests__/manager.test.ts                # 37
```

### Owner wake (dist — do not kill Chrome)

1. From `projects/chijie-browser`: `pnpm inject:personal && pnpm build` when convenient  
2. Reload unpacked extension in Chrome  
3. Retry task — setup issues should show **模型或密钥未就绪**, not 引擎启动失败

---

## B) `waiting_user` + `commit_outcome_uncertain` 且无 criterion-confirm

### Code path (by design)

| Source | When |
|--------|------|
| `TaskManager.recover()` | SW restart while attempt.state=`executing` → recover to `uncertain`, status `waiting_user`, waitReason `commit_outcome_uncertain` |
| `persistAttempt` | Live attempt lands on `uncertain` (external_commit throw / transport) → same waitReason + stop driver |

### Why no `criterion-confirm`

`TaskStatusCard` only renders confirm when **all** hold:

```ts
status === 'waiting_user'
&& waitReason === 'proof_required'
&& criteria has user_confirmed without user evidence
```

`commit_outcome_uncertain` is **not** `proof_required` → **no** confirm button (intentional safety: cannot auto-claim external commit success).

Hint copy: `chat_task_hint_uncertain` — 「提交结果不确定…继续或重试」.

### UX gap (not fixed tonight — product)

- Resume control only for `paused` \| `interrupted`  
- Uncertain: only **Stop** + send new chat instruction (`follow_up`)  
- Copy says 继续/重试 but no dedicated primary button for uncertain

Recommended follow-up (separate contract): optional 「我已确认网页结果」→ follow_up / clear waitReason without fake receipt.

### Related: missing instruction

If instruction text cannot be resolved from chat, manager sets `proof_required` **without** freezing `user_confirmed` criteria → also no confirm button; `failureNextStep` suppresses proof hint when no confirmable criteria. Different from uncertain.

---

## Non-goals this run

- No `pnpm build` / no Chrome kill  
- No Feishu 06 / W\*  
- No new uncertain primary button (needs product copy decision)
