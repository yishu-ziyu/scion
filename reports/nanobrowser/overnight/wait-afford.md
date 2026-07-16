# wait-afford — waiting_user primary action (g3-wait-afford)

Date: 2026-07-16  
Repo: `projects/chijie-browser`

## Problem

`criterion-confirm` only renders when `waitReason === 'proof_required'` **and** a `user_confirmed` criterion exists.  
Feishu 06 / login / commit uncertain lands on `waiting_user` with **no** primary button (only 停止).

## Product rule (minimal)

| status | waitReason | Affordance |
|--------|------------|------------|
| waiting_user | `proof_required` | `criterion-confirm` (unchanged) |
| waiting_user | `commit_outcome_uncertain` | **`wait-retry`** → `resume` |
| waiting_user | any other (login, captcha, target_…) | **`wait-continue`** → `resume` |
| other statuses | — | no new control |

## Code

| Path | Change |
|------|--------|
| `pages/side-panel/src/presentation/wait-affordance.ts` | pure `waitUserActionTestId` |
| `pages/side-panel/src/components/TaskStatusCard.tsx` | render wait-continue / wait-retry |
| `chrome-extension/.../task/manager.ts` | `resume` accepts `waiting_user`; clear `waitReason`; re-enter `runDriver` or `runCurrentRound` |
| i18n zh_CN/zh_TW/en/pt_BR | `chat_task_wait_continue` / `chat_task_wait_retry` |

## Safety

- User click only (no auto-retry after uncertain).
- Disconnect uncertain test updated: resume **accepted**, same `executeExternalCommit` not re-invoked.
- `proof_required` still uses confirm path only.

## Tests (exit 0)

```bash
pnpm -F @extension/sidepanel test -- src/presentation/__tests__/wait-affordance.test.ts   # 8
pnpm -F @extension/sidepanel test -- src/design/__tests__/ui-acceptance.test.ts -t "waiting_user non-proof"  # 1
pnpm -F chrome-extension test -- src/background/task/__tests__/manager.test.ts             # 38
pnpm -F chrome-extension test -- src/background/task/__tests__/commit-recovery.integration.test.ts  # 1
```

Note: full `ui-acceptance.test.ts` has 3 pre-existing stack overflows from prod `@extension/i18n` ↔ chrome.i18n stub recursion when importing TaskStatusCard helpers; source-string wait-afford assertion passes under `-t "waiting_user non-proof"`.

## Owner wake

`pnpm build` + reload extension when convenient. Do not kill Chrome from agents.
