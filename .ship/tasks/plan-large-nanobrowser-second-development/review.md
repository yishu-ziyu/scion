# Code Review

Fixed point: `4098cb5b778d8a2614b83ffa3b80adaead809d11`  
Reviewed target: `259cb4ae9c9093f267bcd810675cc73e6d1618b0` plus the tracked worktree change in `dev-context.md`

## Findings

### Standards axis

#### P1: Connected fixture runs erase real Nanobrowser data

- File: `projects/yishu-browser/chrome-extension/scripts/action-agent-e2e.mjs:439`
- Trigger: run `e2e:action-agent` with the supported `CDP_URL` or `CONNECT_URL` path (`:15`, `:589-592`). `runAllScenarios` calls `resetExtensionState` at `:460`, which removes the complete `favorites`, task, Skill-save, `chat_sessions*`, and `chat_messages_*` stores.
- Impact: when connected to the required main-Chrome workflow, the test irreversibly deletes the owner's saved prompts/Skills, task state, and chat history. This is user-data loss.
- Fix: refuse destructive reset in connect mode. Use an owned temporary profile, or delete only records created and namespaced by the fixture.

#### P2: Owner acceptance protocol uses a second empty Chrome profile

- File: `reports/nanobrowser/action-agent-cycle-1.md:57`
- Trigger: follow the documented owner-journey command; it creates `.tmp/scion-owner-acceptance` and launches Chrome with that new `user-data-dir`.
- Impact: Feishu/Bilibili results do not exercise the owner's daily Chrome and existing login state, contrary to `AGENTS.md:60`, `projects/yishu-browser/AGENTS.md:52,114`, `HANDOVER.md:244-245`, and the PRD's daily-Chrome contract (`docs/product/001-nanobrowser-prd.md:23-24,80`).
- Fix: run owner acceptance in main Chrome with the existing profile/login state; keep the isolated profile only for local deterministic fixtures.

#### P3: The new fail-fast branch ignores immediate terminal failures

- File: `projects/yishu-browser/chrome-extension/scripts/action-agent-e2e.mjs:414`
- Trigger: a new Skill run reaches `failed` or `cancelled` before the 2.5-second poll observes `running`, while the expected submission count has not been reached. The `snap.status === 'completed'` condition at `:418` is unreachable inside a `failed|cancelled` branch, and `:420-421` ignores the real terminal until the 180-second timeout.
- Impact: failed fixture runs stall for the full timeout and the report's “fail-fast” claim is false.
- Fix: identify the new run by task ID/revision or command acknowledgement, then fail immediately on its terminal state.

No separate ship-impacting Fowler smell was proven.

### Spec axis

#### P1: The reported approval scenario can pass an unapproved external commit

- File: `reports/nanobrowser/action-agent-cycle-1.md:24`
- Trigger: an approval-policy regression submits the form before `approval-approve` appears. The report claims the fixture covers approval, but `action-agent-e2e.mjs:297-298` accepts `completed + receipt + count >= 1`; `:473-478` then skips both the approval card and the pre-submit zero-count assertion.
- Impact: the release evidence can pass the exact forbidden outcome: an external commit with no observed one-use approval. This violates PRD acceptance/release gates at `docs/product/001-nanobrowser-prd.md:257,275-277` and the planned check at `.ship/tasks/plan-large-nanobrowser-second-development/plan/plan.md:1714-1719`.
- Fix: fail as soon as submission count is non-zero before approval; require the approval card and `count === 0`, click once, then require `count === 1` and verified receipt.
- Scope note: the permissive helper predates `259cb4a`, but the new acceptance report introduced in this commit depends on it and overstates what the run proves.

#### P2: Sessionless Skill tasks cannot preserve follow-up continuity

- File: `projects/yishu-browser/pages/side-panel/src/SidePanel.tsx:160`
- Trigger: a Skill-originated task has no `chatSessionId` by design (`chrome-extension/src/background/task/manager.ts:332-355`) and reaches `waiting_user` or `completed`; the user then sends “continue” or “pause this.” The new code disables follow-up at `SidePanel.tsx:162-163`, creates a new session at `:503-517`, and sends `start` at `:533-557`.
- Impact: for `waiting_user`, TaskManager rejects the new start because the Skill task is still active; for `completed`, a new task loses the original task/round and target references. This violates same-Task/target follow-up requirements in `.ship/tasks/plan-large-nanobrowser-second-development/plan/spec.md:49` and PRD `PR-02` at `docs/product/001-nanobrowser-prd.md:177-180`.
- Fix: create/bind the chat session for the first user-authored follow-up, but dispatch `follow_up` against the existing Skill task ID and revision.

#### P2: Media fixture can cancel play and still claim play-to-pause coverage

- File: `projects/yishu-browser/chrome-extension/scripts/action-agent-e2e.mjs:210`
- Trigger: after `sendGoal("Play...")`, `waitStatus(..., "completed")` at `:543` can match the prior completed Skill snapshot because it does not wait for a new task/round. The second `sendGoal` calls `ensureGoalSend`, which clicks Stop at `:222-229` if play is now running. The only target assertion at `:546` checks `paused === true`, which is also the fixture's initial state.
- Impact: the harness can report media PASS after cancel/new-start or without proving that play completed, that pause was a follow-up on the same task/target, or that a second receipt exists. PRD gates `docs/product/001-nanobrowser-prd.md:260,281` remain unproven.
- Fix: wait for a distinct task/round and verified play receipt, assert `paused === false`, send a same-task follow-up without auto-cancel, then require a second receipt and `paused === true`.

#### P2: Failure diagnostics copy form and Skill values into logs

- File: `projects/yishu-browser/chrome-extension/scripts/action-agent-e2e.mjs:364`
- Trigger: any waiting-user, failure, or slow-post-submit diagnostic calls `dumpTaskStorage`; `:365-379` copies recent chat `content`, including `FIELD_SENTINEL_8472` and `FIELD_SENTINEL_CHANGED_9521`, and `:381` writes it to console.
- Impact: form/Skill inputs enter test or CI logs even though the storage-only privacy assertion passes. This violates PRD `PR-09` (`docs/product/001-nanobrowser-prd.md:237-239,286`) and its release blocker at `:313`.
- Fix: log actor/state/count and redacted identifiers only; never copy chat content into diagnostics.

## Evidence

Scope validation:

```text
git rev-parse --verify 4098cb5^{commit}  # 4098cb5b778d8a2614b83ffa3b80adaead809d11
git rev-parse --verify 259cb4a^{commit}  # 259cb4ae9c9093f267bcd810675cc73e6d1618b0
git merge-base 4098cb5 259cb4a        # 4098cb5b778d8a2614b83ffa3b80adaead809d11
git log --oneline 4098cb5..259cb4a   # one commit: 259cb4a
git diff --name-status 4098cb5..259cb4a
git diff --name-status
git diff --cached --name-status
```

Inspection commands:

```text
git diff --unified=100 4098cb5..259cb4a -- projects/yishu-browser
nl -ba projects/yishu-browser/chrome-extension/scripts/action-agent-e2e.mjs
nl -ba projects/yishu-browser/pages/side-panel/src/SidePanel.tsx
rg -n "task-runtime-v1|favorites|chat_messages_|chat_sessions" projects/yishu-browser
rg -n "plannerSystemPromptTemplate|waiting_user|chatSessionId" projects/yishu-browser
```

Runnable checks:

```text
corepack pnpm -F chrome-extension test -- src/background/agent/__tests__/planner-completion.test.ts  # PASS 3/3
corepack pnpm -F @extension/sidepanel type-check                                                    # PASS
node --check chrome-extension/scripts/action-agent-e2e.mjs                                         # PASS
git diff --check 4098cb5..259cb4a                                                                  # only PRD blank line at EOF
```

The full changed files, direct SidePanel/TaskManager/storage consumers, both specs, both `AGENTS.md` files, `CLAUDE.md`, `CONTRIBUTING.md`, `HANDOVER.md`, and `CONTEXT.md` were read. Untracked `*.bak-20260714` files were excluded as directed.

## Residual risks

- Static review only: `RUNS=10`, real Feishu/Bilibili owner journeys, and browser/model behavior were not executed.
- The targeted tests and type-check are green, but none exercises the new sessionless-Skill follow-up path or asserts task/round identity in the media journey.

## [Review] Report Card

| Field | Value |
|-------|-------|
| Status | FINDINGS |
| Summary | 7 findings across Standards and Spec |
| Matt upstream read | `vendor/mattpocock-skills/skills/engineering/code-review/SKILL.md` |

### Metrics

| Metric | Value |
|--------|-------|
| P1 | 2 |
| P2 | 4 |
| P3 | 1 |

### Artifacts

| File | Purpose |
|------|---------|
| `.ship/tasks/plan-large-nanobrowser-second-development/review.md` | Two-axis findings with evidence |

### Next Steps

1. **Fix findings** — `/yishuship:dev`
2. **QA next after fixes** — `/yishuship:qa`
3. **Full workflow** — `/yishuship:auto`
