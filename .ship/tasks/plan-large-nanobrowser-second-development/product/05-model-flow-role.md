# Model, flow, and roles

## Business Data Model

### TaskSession

- `id`
- `goalSummary`, `chatSessionId`, `instructionMessageId`（原始普通任务只保留在用户聊天）
- `sourceSkillId`（仅 Skill 运行；解析输入不持久化）
- `status`: `running | paused | waiting_approval | waiting_user | inputs_required | interrupted | completed | failed | cancelled`
- `activeTabId`
- `targetRefs`
- `currentRoundId`
- `rounds`
- `createdAt`, `updatedAt`

### TaskRound

- `id`, parent task ID, instruction message reference/redacted summary, status, revision;
- frozen completion criteria with target, baseline, freshness and timeout;
- action attempts, approvals, evidence and one immutable receipt;
- original command acknowledgements keyed by command ID for restart-safe idempotency.

### ActionAttempt

- task/round ID, step/action identity, intent, redacted normalized action input;
- observed target summary;
- risk classification and approval reference;
- durable state: `proposed | approved | executing | observed | uncertain | failed`;
- result/error and before/after observation timestamps.

### ApprovalRequest

- task ID, proposed effect, target/site, reason, status, created/resolved timestamps.

### CompletionEvidence

- task/round/criterion ID, target reference, predicate/operator, baseline, expected value, observed value, URL/tab, timestamp, freshness, pass/fail.

### LocalSkill

- ID, name, instruction template, declared inputs, completion criteria, approval policy, source task, version, timestamps.

### SkillRun (ephemeral)

- Skill ID/version, in-memory resolved inputs, resulting task session ID. Resolved inputs are not persisted; an interrupted run asks for them again.

## Object Relationships

```text
LocalSkill 1 ── N SkillRun ── 1 TaskSession
TaskSession 1 ── N TaskRound
TaskRound 1 ── N ActionAttempt
TaskRound 1 ── N ApprovalRequest
TaskRound 1 ── N CompletionEvidence
TaskRound 1 ── 0..1 immutable receipt
TaskSession N ── N BrowserTarget (stored as stable references, not owned tabs)
```

## Workflow

1. User starts a task or local Skill.
2. Task session creates a round and stores the instruction, baseline observation, candidate completion criteria, and current tab.
3. Planner/Navigator proposes actions using existing browser state.
4. The action policy either allows execution, requests approval, or blocks it.
5. The shared dispatcher persists `proposed`; external commits progress through `approved` then `executing` before the browser call and `observed` afterward.
6. Action execution records an observation and updates target references. A cold `executing` external commit becomes `uncertain` and `waiting_user`, never replay.
7. Follow-up messages resolve through the same task session but create a new round and receipt.
8. Frozen supported completion predicates are evaluated against fresh post-action observations; unsupported proof becomes `waiting_user`, never automatic success.
9. A `user_confirmed` criterion is satisfied only by a dedicated confirmation command bound to the current round, criterion and revision; ordinary follow-up text cannot satisfy it.
10. User may save the completed semantic contract as a local Skill.

## Roles and Handoffs

- User: supplies goal/inputs, handles login/CAPTCHA, approves high-impact actions, may confirm ambiguous outcomes.
- Task runtime: owns state transitions, routing, persistence, evidence, and approvals.
- Planner: reasons about progress and proposes next steps; it does not have final authority to mark success.
- Navigator/action registry: executes allowed browser actions.
- BrowserContext: owns page/tab attachment and browser observations.
- Skill store: persists local reusable task definitions; it never stores credentials.
