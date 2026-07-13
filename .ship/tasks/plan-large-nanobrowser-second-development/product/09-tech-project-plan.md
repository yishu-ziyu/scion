# Technical and project plan

## Architecture Decision

### Alternatives

### A. Patch the current global Executor

Add approval and evidence directly to `background/index.ts` while retaining `currentExecutor` and UI-owned lifecycle.

- Benefit: smallest initial diff.
- Cost: lifecycle, recovery, follow-up routing, and persistence stay coupled to the side-panel port; later fixes repeat across message branches.
- Decision: reject. It fixes symptoms at the wrong boundary.

### B. Task-session runtime inside the existing extension — selected

Use the existing empty `background/task/manager.ts` as the single task lifecycle owner. It creates/continues one TaskSession, owns the Executor, dispatches events, persists state/evidence, and routes follow-ups. Existing BrowserContext, action registry, Planner/Navigator, storage base, chat history, favorites UI, firewall, and guardrails remain.

- Benefit: addresses the root lifecycle gap without replacing the browser or agent stack.
- Cost: requires explicit task state and recovery semantics.
- Decision: selected.

### C. Standalone Chromium or cloud browser runtime

- Benefit: stronger control over process lifetime, tabs, and isolated parallel tasks.
- Cost: browser distribution/security maintenance, migration friction, lost real-profile continuity, and much larger scope.
- Decision: reject for this cycle. Revisit only if extension lifecycle prevents the measured product outcome.

## Technical Plan

### Selected component boundaries

```text
SidePanel
  → TaskManager (one active task; lifecycle + routing)
      → TaskStore (TaskSession, approvals, evidence)
      → Executor (existing Planner/Navigator loop)
          → ActionDispatcher (normalize / target / persist / policy / execute)
              → EffectPolicy (allow / approval / block)
          → ActionBuilder + BrowserContext (existing execution)
      → CompletionChecker (supported observable predicates)
  → LocalSkill storage/UI (evolves existing favorites surface)
```

### Key technical decisions

1. Keep Chrome Manifest V3 extension architecture; do not fork Chromium.
2. Move task ownership out of background globals into the existing empty task manager module.
3. Persist semantic state and execution rounds, not LangChain object graphs. A cold resume creates a fresh Executor with the stored goal, round summary, frozen criteria, and current browser observation.
4. Persist every action attempt through explicit states. For external commits, consume approval and persist `executing` before the browser call; cold recovery from `executing` is `uncertain/waiting_user`, never replay.
5. Put one ActionDispatcher on the Navigator's shared action path. It normalizes actions, resolves target snapshots, persists attempts, invokes EffectPolicy, stops the remaining multi-action batch when approval is required, and executes the approved exact action only if the page fingerprint still matches.
6. Disable legacy raw action replay and migrate/delete its stored raw histories. New runtime events, logs and history use action-schema redaction.
7. Treat Planner completion as a proposal. Freeze criteria with round/target/operator/baseline/freshness/timeout and evaluate only fresh observations. State-changing tasks require evidence not already true at baseline.
8. Implement site-neutral HTML media observation/control in M3; do not add Bilibili-specific logic.
9. Evolve the existing favorite prompt storage/UI into local Skills with optional structured fields. Existing favorites remain valid as prompt-only entries.
10. Keep arbitrary JavaScript generation/execution out of cycle 1.
11. Serialize commands per task with a revision and client command ID. `dispatch` returns an acknowledgement within 200ms; LLM/page work continues through events.

### Interfaces and test seams

### TaskManager commands

- `start(goal, tabId)`
- `followUp(taskId, instruction)`
- `approve(taskId, approvalId)` / `reject(...)`
- `resume(taskId)` / `cancel(taskId)`
- `confirmCompletion(taskId, roundId, criterionId, revision)`
- `get(taskId)`
- `saveSkill(taskId, definition)`

Every state-changing command carries `commandId` and `expectedRevision`. A start while another task is active is rejected; follow-up is queued at the next safe action boundary; pause/cancel are applied before the next action; approve/reject must match the current approval and revision; completion confirmation must match the current waiting-user round and criterion and persists user-sourced evidence.

### Runtime events

- task state changed;
- action proposed/started/finished;
- approval requested/resolved;
- criterion checked;
- completion receipt produced;
- task interrupted/failed.

These become the stable integration seam between background and side panel. Existing execution events may be adapted rather than replaced wholesale.

## Project Plan

## Milestones

### M0 — product and architecture handoff

- Finish intake, detailed design, peer cross-review, and acceptance mapping.

### M1 — task lifecycle

- TaskSession + TaskRound storage/state machine;
- TaskManager replaces global Executor ownership;
- per-task serial command queue, revision/idempotency, explicit completion confirmation, background message routing and reconnect state.

### M2 — safe verified form slice

- shared action policy and approval UI;
- ActionDispatcher and persistent action-attempt protocol;
- completion predicates with baseline/freshness/evidence/receipt;
- deterministic form fixture and real Feishu acceptance.

### M3 — continuous media slice

- durable target references and follow-up routing;
- required generic HTML media control/observation;
- deterministic media fixture and Bilibili acceptance.

### M4 — local Skill slice

- save verified task as parameterized Skill;
- input collection and run;
- changed-DOM robustness check.

### M5 — hardening and handoff

- full test/build/security review;
- real Chrome evidence;
- documentation, migration notes, and scoped next cycle.

## Owners

- Product decisions and acceptance: Owner.
- M1–M5 architecture, implementation, automated checks, redaction migration, and evidence: Engineering DRI.
- Product decisions, fixed real-browser test protocol, login setup, and acceptance verdict: Owner DRI.
- CAPTCHA handling and final approval of real external commits: Owner.

## Risks and Mitigations

- MV3 worker lifetime: persistent action states plus restart injection at every boundary.
- Duplicate side effects: approval token is consumed before execution; cold `executing` external commits become uncertain and never retry.
- False completion: frozen target/round criteria with baseline and freshness plus `waiting_user` fallback.
- Approval bypass: one ActionDispatcher for normal/multi-action execution; legacy replay is disabled and click/Enter paths are tested.
- Sensitive values: action-schema redaction at event/history/logger boundaries and deletion of old raw replay data.
- Command races: per-task serial queue, revision checks and command idempotency.
- Model variance: typed schemas, existing MiniMax parsing hardening, fixture run thresholds.
- Website changes: semantic replanning and stable observations, not recorded indexes.

## Engineering entry gate

Implementation may begin only after detailed architecture design maps every PRD requirement to code surfaces and tests, and independent review has no unresolved blocking findings.
