# G1 promote — block continue after uncertain approved write

**Time:** 2026-07-16 ~02:22 CST  
**Source:** gnhf residual f6a45b commit f757790  
**Main:** promoted + reconciled with soft-return tests  

## Change

- `TaskManager.followUp`: reject when `waiting_user` + `commit_outcome_uncertain` (same as resume)
- Manager tests expect soft-return resolve (not rethrow) after dispatch soft-return ship

## Matt

```text
pnpm -F chrome-extension test -- src/background/task/__tests__/manager.test.ts
# 32/32 exit 0
```

## Boundary

No Feishu golden e2e claim. Closes unsafe continue after uncertain write only.
