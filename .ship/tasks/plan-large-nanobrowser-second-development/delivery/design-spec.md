# Engineering design specification

## Engineering Goal

Turn the existing Nanobrowser execution loop into a dependable single-task browser action runtime: complete whole browser tasks, preserve contextual follow-up control, require evidence before success, gate consequential actions, and save verified tasks as local semantic Skills.

## Product Context

The product is a C-side browser action Agent inside the user's existing Chrome profile. The owner expects complete action chains such as filling and submitting a Feishu form, and continuous commands such as playing then pausing the same Bilibili video. Opening a page or returning a plausible answer is not completion.

## Requirements

1. Replace background global Executor ownership with a deep TaskManager module supporting one active task.
2. Persist TaskSession plus TaskRound status, revision, processed command IDs, target references, frozen completion criteria, action-attempt state, approvals, evidence, and immutable receipts using existing Chrome local storage patterns.
3. Route new, follow-up, approve/reject, resume/cancel, get, and save-Skill commands through TaskManager.
4. Put one ActionDispatcher before every normal/multi-action execution path; it normalizes the action, resolves the target, persists the attempt, invokes EffectPolicy, and stops the remaining batch on approval/block.
5. External commits must persist `proposed → approved → executing → observed/uncertain`; consume approval before the browser call and never replay a cold `executing` commit.
6. Treat Planner `done` as a proposal; freeze round/target/operator/baseline/freshness/timeout completion conditions and evaluate fresh observations before `completed`.
7. On lifecycle interruption, mark ordinary work `interrupted` and uncertain external commits `waiting_user`; explicit resume must re-observe.
8. Save only semantic Skill instructions, input schemas, completion conditions, and approval policy. Do not replay stale element indexes or run generated JavaScript.
9. Disable/delete legacy raw replay history and redact values at runtime event, UI, logger, analytics, receipt and new history boundaries.
10. Serialize commands with client command IDs and revisions; acknowledge acceptance quickly and run LLM/page work asynchronously through events. User confirmation uses a dedicated current-round/current-criterion command and persists user-sourced evidence; ordinary follow-up text cannot confirm completion.
11. Reuse BrowserContext, Executor, ActionBuilder, chat/storage base, favorites surface, firewall, guardrails, and existing message/event types where they remain sound.
12. Keep normal-task raw instructions only in the existing user-authored chat record; TaskSession/TaskRound store `chatSessionId + instructionMessageId` and a redacted summary. Keep resolved Skill values in memory only; after cold interruption set `inputs_required` and require a new Skill task with re-entered values.

## Acceptance Criteria

1. Deterministic form fixture: fields filled, submit blocked for approval, approved once, success evidence checked, receipt produced.
2. Rejected submit never executes and task remains controllable.
3. Planner cannot mark completion when a required condition fails.
4. `click_element` and `send_keys Enter` submission paths both hit the shared approval policy.
5. Deterministic media fixture and real Bilibili: play target video, bind follow-up “暂停这个视频”, verify `paused=true`.
6. Reopen side panel after interruption: stored state is shown; no false success or automatic duplicate commit.
7. Save a verified form task as a local Skill; rerun with changed inputs and reordered fixture DOM succeeds through replanning.
8. Existing BrowserContext tests, extension tests, lint, type checks excluding already documented unrelated failures, production build, and real Chrome acceptance are green or explicitly evidenced.
9. Restart injection at every external-commit persistence boundary proves zero automatic duplicate commits.
10. Criteria already true at baseline, from the wrong target, wrong round, or before the required action cannot prove completion.
11. Duplicate/racing commands are serialized and idempotent; stale approve/reject revisions are rejected.
12. Stored legacy replay data is removed, and runtime-generated events/storage/logs contain no form or Skill values.
13. Current valid completion confirmation succeeds once; old-round, wrong-criterion, stale-revision and duplicate confirmation attempts cannot complete a round.

## Constraints

- Manifest V3 Chrome extension; one active task; no Chromium fork or cloud browser.
- No website-specific Feishu/Bilibili adapter; site-neutral media observation/control is required in M3.
- No background execution promise after Chrome closes; no parallel tasks.
- No credential/CAPTCHA automation, arbitrary JavaScript, Skill sharing, marketplace, enterprise roles, or billing.
- Do not persist credentials, resolved form/Skill values, full page bodies, screenshots, LangChain objects, DOM nodes, or element indexes in TaskSession/Skill data. User-authored local chat may retain the explicit instruction but runtime logs must not duplicate its values.
- Implement tracer bullets in this order: lifecycle → verified form → continuous media → local Skill.

## Source Artifacts

- `product/00b-scope-challenge.md`
- `product/03-problem-solution.md`
- `product/06-experience-spec.md`
- `product/07-data-permission-analytics.md`
- `product/08-prd.md`
- `product/09-tech-project-plan.md`
- `docs/design/001-browser-action-task-runtime.md`
- `docs/decisions/001-keep-chrome-extension.md`
- `CONTEXT.md`
