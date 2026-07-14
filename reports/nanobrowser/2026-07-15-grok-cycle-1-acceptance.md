# Grok cycle 1 acceptance — 2026-07-15

## Verdict

**REJECTED / not ready for acceptance.**

Reviewed commit: `259cb4ae9c9093f267bcd810675cc73e6d1618b0`  
Direct base: `4098cb5b778d8a2614b83ffa3b80adaead809d11`

The build and unit suite are healthy, and the deterministic form/reconnect/Skill legs work once. The required media and owner-journey gates are not met, and static review found safety and correctness defects in the new acceptance surface.

## Acceptance results

| Surface | Result | Evidence |
|---|---:|---|
| Chrome-extension unit suite | PASS | 20 files, 174/174 tests |
| Production build | PASS | 5/5 build tasks |
| Deterministic form fixture | PASS once | approval → submit → verified receipt |
| Reconnect fixture | PASS once | task state restored |
| Saved Skill fixture | PASS once | saved, rerun after DOM reorder, second submit observed |
| Deterministic media fixture | FAIL | runner stopped producing progress after the Skill leg and was manually terminated; play → same-task pause was not demonstrated |
| Required deterministic repetition | FAIL | PRD requires 10/10; Grok's own report says `RUNS=10` is not complete |
| Main-Chrome Bilibili journey | FAIL (0/1 completed) | current `dist` opened a real video and media was playing, but the Task remained `进行中` for more than 150 seconds and produced no completion evidence; the pause follow-up could not start |
| Main-Chrome Feishu journey | NOT RUN | no fixed form target, declared success criterion, or Grok result was supplied; PRD requires at least 8/10 |
| Required real-site repetition | FAIL | PRD requires Feishu and Bilibili at least 8/10 each; Grok's report records neither |
| Repository type-check | FAIL | existing `schema-utils` missing-module errors; Chrome workspace also has two existing errors |
| Repository lint | FAIL | 16 Chrome errors; side panel has 1 existing error and 3 warnings |

Main-Chrome runtime evidence: `reports/nanobrowser/logs/2026-07-15-002145-session.md`. The extension was reloaded first and the loaded side-panel asset matched the newly built `dist` (`index-DvwP43OB.js`). Test-created tabs were closed, media was paused, and the original Bilibili tab was restored.

## Blocking findings

1. **Connected E2E can delete owner data.** `action-agent-e2e.mjs` resets favorites, Tasks, Skills, and chat stores even when attached through `CDP_URL`/`CONNECT_URL`.
2. **Approval coverage can false-pass.** The form helper accepts `completed + receipt + count >= 1`, so a submit that happened before approval can still be reported as passing.
3. **Media coverage can false-pass.** The media runner can observe a previous completed snapshot, cancel the play task when sending pause, and accept the fixture's initially-paused state without proving same-Task target continuity.
4. **Sessionless Skill follow-ups lose continuity.** A follow-up after a Skill task can be rejected as a new Task or lose the original Task/round and target reference.
5. **Failure diagnostics expose raw inputs.** Recent chat/form/Skill content is copied into console diagnostics instead of being redacted.
6. **The documented owner protocol uses an empty temporary profile.** That contradicts the project's required main-Chrome/existing-login acceptance surface.

Full two-axis review: `.ship/tasks/plan-large-nanobrowser-second-development/review.md` (2 P1, 4 P2, 1 P3).

## Decision

Do not mark Story 7 or the PRD release gates complete. A corrective round must fix the blocking findings, make the media fixture prove distinct Task/round receipts and play→pause state, pass deterministic runs 10/10, then record main-Chrome Feishu and Bilibili results at least 8/10 each with zero false completion and zero unapproved commit.
