# PRD — browser action runtime

## Product Requirements

### R1. Whole-task execution

The Agent must continue through navigation and interaction steps until the task reaches a verified completion condition, needs user action/approval, fails, or is cancelled.

### R2. Task session and continuous control

Every new task must create a persisted task session and execution round. Follow-up instructions must resolve against that session's current goal, tab, target references, and prior outcomes, then create a new round with its own evidence and immutable receipt. Commands carry idempotency IDs and are serialized per task. Only one active task is required in cycle 1.

The user-authored local chat message is the sole durable raw instruction for a normal task; task state stores its reference and a redacted summary. Resolved Skill inputs remain memory-only and must be entered again after a cold interruption.

### R3. Completion contract and receipt

A task round must freeze one or more observable completion criteria before execution or an external commit. Each criterion binds a round, target, operator, baseline, freshness rule, and timeout. Planner `done=true` is only a candidate completion signal. The runtime marks a round `completed` only after fresh supported criteria pass or the user explicitly confirms a current `user_confirmed` criterion through a dedicated command. Ordinary chat text is not completion evidence. A receipt records the evidence.

Cycle-1 predicate set:

- URL matches/changes;
- visible text present/absent;
- interactive element state/value;
- HTML media state (`playing | paused`);
- explicit user confirmation.

### R4. Action approval

All normal and multi-action execution passes through one ActionDispatcher that validates/normalizes the action, resolves the target snapshot, applies effect policy, persists the attempt, and then executes. External commits require a one-use approval consumed and persisted before the browser call. A cold `executing` external commit becomes uncertain and cannot replay. Forbidden actions cannot execute. Legacy raw replay is disabled and removed rather than bypassing this dispatcher.

### R5. Recovery

Task metadata, rounds, evidence, approvals, action-attempt state, and semantic progress survive side-panel reconnection and service-worker restart. A non-commit action interrupted in flight becomes `interrupted`; an external commit interrupted after `executing` becomes `waiting_user/uncertain`. The user explicitly resumes after a fresh observation. Cycle 1 does not promise invisible background continuation.

### R6. Local Skill

A verified completed task can be saved locally as a Skill containing a semantic instruction template, declared inputs, completion criteria, and approval policy. Running a Skill creates a new task session and replans against the current page; it must not replay stale element indexes.

### R7. Browser boundary

Reuse the current Chrome extension, BrowserContext, action registry, storage utilities, firewall, and prompt-injection guards. Add no Feishu/Bilibili-specific adapter and no standalone browser.

## Acceptance Criteria

1. On a form fixture, the Agent fills multiple fields, stops before submit, resumes after approval, submits, observes the success state, and emits a verified receipt.
2. A rejected submit is not executed and the task remains resumable/cancellable.
3. On an HTML5 media fixture and then Bilibili, the Agent starts a selected video; the follow-up “暂停这个视频” binds to the same tab/media and verifies `paused=true`.
4. Closing and reopening the side panel preserves the last task state and receipt. If execution was interrupted, the UI says so instead of reporting success.
5. A completed form task can be saved as a local Skill, run with different input values, and succeed even when fixture element indexes/order change.
6. A task cannot be marked completed from Planner `done=true` when a required criterion fails.
7. `send_keys Enter` and click-based submit both pass through the same approval policy.
8. No credential value, form value, or page body is emitted through analytics.
9. Restart injection at every external-commit persistence boundary never causes a duplicate commit; recovery from `executing` is uncertain/waiting-user.
10. Completion criteria already true at baseline or observed before the required action cannot prove a state-changing task complete.
11. Duplicate command IDs are applied once; conflicting approve/cancel/follow-up commands resolve by task revision and the per-task serial queue.
12. Legacy raw replay history is removed/disabled; runtime-generated storage, UI events, analytics and logs contain no input values.
13. `confirm_completion` requires current task/round/criterion/revision and a unique command ID; stale-round, wrong-criterion, stale-revision and duplicate confirmations cannot incorrectly complete a round.

## Success Metrics

- 100% pass on the two deterministic fixture journeys across 10 consecutive runs each.
- At least 8/10 verified completions on each real-browser golden journey under the pre-registered valid-attempt protocol below.
- Zero false-positive completion in fixture tests and owner acceptance runs.
- Zero external commit executed without a recorded approval.
- At least one saved Skill successfully rerun with changed inputs and changed element order.
- Follow-up target binding succeeds in 10/10 deterministic media runs.
- At least 80% of valid real-browser runs complete with no recovery intervention beyond the explicitly required external-commit approval.

Valid real-browser attempt protocol:

- fixed current build, one declared test account, declared task inputs, reachable target site, account already logged in, and no CAPTCHA at start;
- exclude only Chrome/extension version mismatch, site/network outage confirmed outside the Agent, expired login before start, CAPTCHA present before start, or invalid test data;
- login/CAPTCHA appearing after execution starts is a product `waiting_user` outcome and remains in the run report;
- run 10 attempts per golden journey with the same protocol and publish the full taxonomy.

## Assumptions

- Existing action primitives are sufficient for most form navigation; validate with fixture and Feishu.
- A small generic predicate set can verify the first journeys; falsify if site state cannot be observed without a site adapter.
- Users tolerate approval only for external commits; test intervention counts.
- Semantic Skill templates are more robust than action replay; validate by changing fixture element order.
- The owner will reuse a saved Skill; validate through a seven-day local rerun.

## Kill Criteria

- Stop the cycle and revisit the execution approach if either golden journey cannot exceed 5/10 verified completion after at most two root-cause repair rounds under the fixed valid-attempt protocol.
- Do not ship automatic external commits if any tested path bypasses approval.
- Remove “save as Skill” from the release if it cannot survive changed element order and only behaves like replay.
- Do not claim durable recovery if service-worker restart can produce duplicate external commits.
- Reconsider MiniMax-only routing if model failures dominate more than half of valid task failures after parser issues are excluded.

## Testing Seams

- Pure state-transition and effect-policy tests at the task runtime boundary.
- Restart-injection tests at `proposed`, `approved`, `executing`, and `observed` persistence boundaries.
- Command queue/revision/idempotency tests for start, follow-up, approve, reject, pause, resume, cancel and confirm-completion races.
- Dedicated user-confirmation tests for current/old round, correct/wrong criterion, stale revision and duplicate command ID; accepted confirmation persists user-sourced evidence.
- Storage round-trip/migration tests for TaskSession and LocalSkill.
- Existing action/BrowserContext tests for target acquisition and action execution.
- Background message integration test: side panel message → task runtime → event/approval/completion response.
- Deterministic extension E2E fixtures for form submit and HTML5 media.
- Real Chrome owner acceptance on Feishu and Bilibili; failures separated into product, model, site, login, and environment categories.

## Vertical Slice Candidates

1. **Verified form commit:** session + approval + postcondition + receipt.
2. **Continuous media control:** follow-up binding + generic media state control/verification.
3. **Local Skill rerun:** save semantic contract + parameter input + replan on changed DOM.

Implement in that order. Each slice leaves a runnable acceptance check.

## Edge Cases

- active tab changes while the Agent is running;
- target tab closes or navigates to a forbidden URL;
- service worker stops after click but before evidence persistence;
- submit creates a new tab, SPA toast, or delayed result;
- page asks for login/CAPTCHA mid-task;
- approval arrives after page state changed;
- duplicated follow-up message;
- multiple media elements exist;
- a completion condition was already true at baseline or is observed from the wrong round/target;
- Skill input is missing or contains secret-like data;
- model reports completion while criteria fail;
- page prompt injection instructs the Agent to change goals.

## Out of Scope

- Chromium fork, mobile browser, native desktop control;
- cloud/background execution while Chrome is closed;
- parallel active tasks;
- Skill sharing, marketplace, discovery, or remote sync;
- arbitrary generated JavaScript;
- legacy raw action replay and raw agent-step history persistence;
- enterprise users, permissions, billing, and dashboards;
- automatic credential entry or CAPTCHA bypass.
