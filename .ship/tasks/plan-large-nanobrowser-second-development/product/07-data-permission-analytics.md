# Data, permissions, and analytics

## Report Design

The only required report in cycle 1 is the task receipt:

- final status;
- criteria and evidence;
- high-impact actions approved/performed;
- active site/tab reference;
- failure or user-intervention reason.

No general reporting dashboard is needed.

## Tracking Plan

Local-first events:

- `task_created`
- `task_started`
- `task_waiting_approval`
- `approval_resolved`
- `task_waiting_user`
- `follow_up_bound`
- `criterion_checked`
- `task_completed_verified`
- `task_failed`
- `skill_saved`
- `skill_run_started`
- `skill_run_completed_verified`

Required measures:

- verified completion rate;
- false-completion count reported by the user;
- median user interventions per completed task;
- follow-up binding success rate;
- Skill save rate and seven-day rerun rate;
- high-impact action count and approval/rejection outcomes.

No prompt text, credentials, form values, or page content leave the browser for analytics.

## Permission Model

Single-user cycle; no RBAC.

Action effect classes:

- `read`: navigation, scrolling, inspection — run automatically within URL policy.
- `reversible`: typing, opening/closing a non-user tab, media control — run automatically and log.
- `external_commit`: submit, purchase, send, publish, delete, permission change — require explicit approval immediately before execution.
- `forbidden`: credential entry, CAPTCHA bypass, browser-internal/extension pages outside allowed bootstrap, secret extraction — block or hand back to the user.

Approvals are task-scoped and one-use; approving one submit does not grant blanket permission.

## Risk Controls

- Keep existing URL firewall and prompt-injection sanitization.
- Put the approval check on the shared action-dispatch path so keyboard/click variants cannot bypass it.
- Persist external commits through `proposed → approved → executing → observed/uncertain`; consume the one-use approval before the browser call.
- Record a before/after observation for external commits. Cold recovery from `executing` is `uncertain` and requires user inspection; it is never retried automatically.
- Store task/Skill metadata in local extension storage; never store credentials in a Skill.
- Do not introduce arbitrary generated JavaScript execution in cycle 1.
- If effect classification is uncertain, pause for approval.
- Disable and delete legacy raw action replay history during migration. User-authored local chat may retain the user's instruction, but task events, receipts, analytics, logs, Skills and new action history must redact field/Skill values.
- Task state references the user-authored chat message instead of duplicating its raw instruction. Resolved Skill inputs are memory-only and must be re-entered after a cold interruption.
