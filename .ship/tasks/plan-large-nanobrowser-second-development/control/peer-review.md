# Independent peer review

Date: 2026-07-13
Scope: product inputs/outputs, engineering handoff, and detailed architecture design.
Reviewer: independent `peer_review_product_arch` agent, read-only.

## Initial verdict

`BLOCKED` — direction was sound, but the first draft was not safe to enter implementation because four P1 contracts were incomplete.

## Findings and host disposition

| Priority | Finding | Disposition | Resolved artifacts |
|---|---|---|---|
| P1 | MV3 crash window could repeat an external side effect because in-flight action state was not durable. | Accept; resolved. Added ActionAttempt states `proposed → approved → executing → observed/uncertain`, approval consumption before browser call, cold `executing` recovery to `waiting_user`, and restart injection tests. | `product/05-model-flow-role.md`, `product/07-data-permission-analytics.md`, `product/08-prd.md`, `product/09-tech-project-plan.md`, `delivery/design-spec.md`, `plan/spec.md`, `docs/design/001-browser-action-task-runtime.md` |
| P1 | EffectPolicy alone could not prove click, Enter, multi-action and replay all passed the same approval seam. | Accept; resolved. Added a single ActionDispatcher that normalizes, resolves target, persists, invokes policy, stops batches, and executes only the approved action after fingerprint recheck. Legacy raw replay is disabled/removed, so no replay bypass remains. | Same architecture and handoff artifacts |
| P1 | Planner-proposed completion conditions could be weak or already true and therefore fail to prove the user's goal. | Accept; resolved. Criteria now freeze before execution/commit and bind round, target, operator, baseline, not-before/freshness and timeout. State-changing tasks require fresh evidence; generic HTML media observation is mandatory in M3. | `product/05-model-flow-role.md`, `product/08-prd.md`, `product/09-tech-project-plan.md`, `docs/design/001-browser-action-task-runtime.md` |
| P1 | Existing raw replay history and runtime events/logging could persist or output form values. | Accept; resolved. First-cycle migration disables replay, deletes `chat_agent_step_*` raw history, and introduces action-schema redaction across generated events/history/logger/analytics/receipts. User-authored local chat is the only permitted copy of explicit non-secret instructions. | `product/07-data-permission-analytics.md`, `product/08-prd.md`, `product/09-tech-project-plan.md`, `delivery/design-spec.md`, `plan/spec.md`, `docs/design/001-browser-action-task-runtime.md` |
| P2 | Continuous follow-up required round ownership, but the draft had one receipt per task. | Accept; resolved. Added TaskRound, immutable per-round receipt, round-scoped attempts/approvals/evidence and command IDs. | `product/05-model-flow-role.md`, `product/08-prd.md`, `docs/design/001-browser-action-task-runtime.md` |
| P2 | `dispatch(): Promise<TaskSnapshot>` conflicted with the 200ms ACK and lacked command race semantics. | Accept; resolved. `dispatch` now returns CommandAck after validation/enqueue; snapshot/events carry execution. Per-task serialization, revision checks, idempotency and command precedence are defined. | `product/08-prd.md`, `product/09-tech-project-plan.md`, `docs/design/001-browser-action-task-runtime.md` |
| P2 | Must-ship owners and real-run exclusions/repair limits were too vague. | Accept; resolved. Engineering and Owner DRIs are explicit; valid-attempt exclusions are pre-registered; real journeys use fixed 10-run protocols; the kill gate allows at most two repair rounds. | `product/00b-scope-challenge.md`, `product/08-prd.md`, `product/09-tech-project-plan.md` |
| P3 | Full-scope lifecycle had no peer-review artifact and marked post-cycle analytics N/A. | Accept; resolved. This file records the review/disposition; checkpoint 20 is now required/post-cycle and intentionally does not block pre-cycle handoff. | `control/peer-review.md`, `control/lifecycle-checklist.yaml` |

## Clean areas confirmed by peer

- Scope materially cuts standalone browser, cloud execution, parallel Agent, enterprise features, Skill market and site-specific adapters.
- Code facts about globals, side-panel cancellation, empty task manager, model-only completion and replay were accurate.
- TaskManager plus pure policy/checker modules is a justified deepening, not gratuitous abstraction.
- Lifecycle → form → media → Skill tracer order and fixture/real-browser test layering are appropriate.
- Research separates facts, inferences and assumptions.

## Host final disposition

All eight findings were accepted and addressed in the cited artifacts. No peer finding was rejected or waived. The product/architecture handoff may proceed to implementation planning only after the corrected artifact gate and final verification pass.

## Focused re-review

The peer confirmed seven findings were fully resolved and identified one remaining ambiguity: `user_confirmed` lacked a dedicated command/evidence contract. Host accepted and resolved it by adding `confirm_completion` bound to `taskId + roundId + criterionId + revision + commandId`, persisted user-sourced evidence, and negative tests for stale/wrong/duplicate confirmation. Ordinary chat text cannot satisfy a completion criterion.

## Final verdict

`PASS` — the independent reviewer confirmed that the dedicated completion-confirmation command, evidence source, state guards, and negative test contract fully close the final finding. No implementation blocker remains in the product or architecture handoff.
