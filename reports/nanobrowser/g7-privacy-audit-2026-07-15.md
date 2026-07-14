# G7 privacy audit (code-level)

Date: 2026-07-15  
Gate: non-chat storage must not hold form values / credentials / full page body / raw replay keys.

## Checks

| Area | Status | Notes |
|------|--------|-------|
| Runtime event redaction | **pass** | `event/privacy.ts` + 10 unit tests |
| Task snapshot no field values | **pass** | control-backend-journey asserts no FIELD_SENTINEL |
| form-journey no secrets | **pass** | existing journey asserts |
| Legacy raw replay | **pass** | replay disabled / migration tests exist |
| Skill save meta | **partial** | templates only; values not stored in task session (prior fix) |
| Side-panel chat | **user messages kept** | by product rule: user-typed chat may keep instruction text |

## Residual risk

- LLM control prompt includes page interactive text in memory of the model call (ephemeral, not persisted by design).
- If a future logger dumps `action_args.text`, that would violate G7 — do not add such logs.

## G7 claim

**Code paths reviewed and unit/journey protected; not a full runtime dump audit of chrome.storage on a long user session.**  
Owner can spot-check: complete a form task, export `chrome.storage.local` task keys, grep for the typed secret.
