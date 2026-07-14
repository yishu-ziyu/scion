# Concerns (Story 6 peer review)

Peer: checker subagent 2026-07-14 — VERDICT PASS_WITH_CONCERNS, then one host fix round.

## Resolved this session

- SW cold start blocked `save_skill` because criterion templates lived only in memory.
  - Fix: `packages/storage/lib/task/skill-save.ts` + `TaskManager` read/write via `getSkillSaveMeta` / `putSkillSaveMeta`.
  - Templates stay out of `TaskSession` snapshot JSON (privacy tests remain green).
  - Coverage: skill-journey cold-restart save test.

## Residual (not blocking Story 6 plan acceptance)

1. `inputs_required` after Skill cold recovery still requires Cancel then re-run from bookmarks; no dedicated re-enter-inputs UI on TaskStatusCard.
2. Rejected `run_skill` may leave SidePanel busy until snapshot updates (`SidePanel.tsx` command path).
3. Sensitive input name denylist is narrow (`password|token|secret|credential` segments); `apikey` / `passwd` not blocked.

Defer residual items to Story 7 hardening or a follow-up story unless they fail real Chrome acceptance.
