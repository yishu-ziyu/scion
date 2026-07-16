HANDOFF|task=g3-dispatch-fail-fix|status=delivered|files=projects/chijie-browser/chrome-extension/src/background/agent/backends/control-llm.ts,projects/chijie-browser/chrome-extension/src/background/task/action-dispatcher.ts,projects/chijie-browser/chrome-extension/src/background/task/__tests__/action-dispatcher.test.ts|tests=action-dispatcher:0 (49); observe-act-loop:0; control-llm-outcome:0|unverified=no live complex/06 agent re-run; dist not rebuilt this beat

# G3 dispatch P0 fix (main working tree)

## Dual note

### 1) What shipped
| File | Change |
|------|--------|
| `control-llm.ts` act catch | **return `{ error }`** — never rethrow into observe-act-loop; `StaleTaskRoundError` → token `stale_task_round` |
| `action-dispatcher.ts` execute catch | persist uncertain/blocked then **return `ActionResult({error})`** — no rethrow |

Effect: throw 不再累积成 `dispatch_failed` / 侧栏「动作调度失败」；external_commit 失败可干净落 `waiting_user`+uncertain。

### 2) Verify + residual
```bash
cd projects/chijie-browser
pnpm -F chrome-extension test -- src/background/task/__tests__/action-dispatcher.test.ts   # 49 pass exit 0
pnpm -F chrome-extension test -- src/background/agent/backends/__tests__/observe-act-loop.test.ts
pnpm -F chrome-extension test -- src/background/agent/backends/__tests__/control-llm-outcome.test.ts
```
- **Not claimed:** agent verified_pass / Feishu 06 live  
- **Not done:** dist rebuild + Chrome reload (owner morning)  
- **No bare complex retry** tonight  

## Prior analysis
`.ship/g-team/handoffs/G3-dispatch-fail.md`

## G3 state
IDLE — no further work unless G1/gnhf needs merge help.
