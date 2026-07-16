# Ticket 06 — overnight blocker (agent e2e)

**Status:** BLOCKED_for_morning / FAIL_honest (agent path)  
**Updated:** 2026-07-16 ~02:25 CST  

## What is green overnight

| Item | Evidence |
|------|----------|
| Complex Owner task (B站→飞书 content) | PRODUCT_PASS · golden/complex-bili-feishu-product-2026-07-16.md · live CDP product_pass |
| dispatch soft-return | control-llm + action-dispatcher · 61/61 unit |
| uncertain follow_up block | manager · 32→34/34 after promote |
| optional-only no false complete | manager allowsVerifiedComplete gate |
| approval replay | invalid_transition · unit |
| wait-affordance | shipped earlier 8/8 |

## What is NOT green

| Item | Evidence |
|------|----------|
| Ticket 06 agent approve→write golden | slice-b FAIL · no verified_pass |
| Agent complex path | selector_miss + 动作调度失败 ×2 · no bare retry |
| Live e2e after soft-return build | not re-run overnight (LESSONS) |

## Blocker (Owner morning)

1. Optional: reload extension (overnight built+rsync; side panel reopened once).  
2. Decide if CDP product path counts as done for complex task (recommend yes).  
3. Ticket 06 agent verified_pass still needs a controlled single-write Feishu e2e with new soft-return + uncertain guards live — not bare overnight thrash.

## Commands (unit only)

```text
pnpm -F chrome-extension test -- src/background/task/__tests__/manager.test.ts
# 34/34 exit 0
```

## gnhf final (02:28)
- Run `scion-only-soft-retu-09f7dd` recorded Owner morning blocker and stopped.
- Observable e2e proof still: 0 pre-approval submit · 1 post-approval · page evidence.
