# Design spec divergence report

Date: 2026-07-13
Host baseline: `.ship/tasks/plan-large-nanobrowser-second-development/plan/spec.md`
Second pass: `.ship/tasks/plan-large-nanobrowser-second-development/plan/peer-spec.md`

Two independent peer dispatches were attempted and timeboxed, but neither produced an artifact. Per the design fallback, `peer-spec.md` is a deliberately separate host second pass and is marked with the required warning. The earlier product/architecture handoff still has an independent peer `PASS`, but this design diff does not claim provider independence.

## Divergences

### 1. Raw instruction persistence

- Host/upstream: TaskSession and TaskRound examples stored `goal` and `instruction`, which can duplicate form values already retained in user-authored chat.
- Second pass: make chat the only durable raw copy; persist message IDs and redacted summaries.
- Evidence: user messages are already stored at `projects/chijie-browser/pages/side-panel/src/SidePanel.tsx:128-147` and `598-605`; the privacy contract forbids runtime copies.
- Disposition: **patched**. `spec.md` now requires an instruction-message reference. Cold normal-task resume reloads that message; Skill-run values remain memory-only and must be re-entered after interruption.

### 2. Duplicate command acknowledgement

- Host/upstream: stored only `processedCommandIds`, while promising a duplicate command returns its original ACK.
- Second pass: IDs alone cannot reconstruct the exact persisted acknowledgement after restart.
- Evidence: the task contract requires revision/idempotency across restart; no current task store exists to compensate.
- Disposition: **patched**. Persist `CommandAck` by command ID in the current round.

### 3. Supplied tab binding

- Host/upstream: named `tabId` in `start` but did not explicitly require the existing BrowserContext to switch before Executor construction.
- Second pass: current background validation ignores the supplied tab.
- Evidence: `SidePanel.tsx:573-630` sends the ID; `background/index.ts:113-121` never uses it for a switch; `browser/context.ts:276-287` already provides the URL-checked operation.
- Disposition: **patched**. TaskManager must `switchTab(tabId)` before creating Executor.

### 4. Login/CAPTCHA semantics

- Host/upstream: product artifacts said `waiting_user`, but implementation planning had not named the contradictory prompts.
- Second pass: Planner marks login as done and Navigator suggests solving CAPTCHA.
- Evidence: `prompts/templates/planner.ts:32-48`; `prompts/templates/navigator.ts:62-69`, `121-124`.
- Disposition: **patched**. Both prompts and typed Executor outcomes must yield `waiting_user`; no completion or automation is allowed.

### 5. Replay contraction order

- Host/upstream: architecture sequence removed replay after introducing TaskManager.
- Second pass: replay is an existing bypass and value store; deleting it first reduces the execution graph before adding the dispatcher.
- Evidence: callers span `SidePanel.tsx:400-531`, `background/index.ts:235-259`, `executor.ts:368-440`, `navigator.ts:461-627`, and `chat/history.ts:32-49`, `228-250`.
- Disposition: **conceded**. The implementation plan starts with complete replay removal and prefix-key migration as a bounded prefactor.

### 6. Deterministic fixtures versus real extension E2E

- Host/upstream: PRD requires deterministic fixture journeys and real-browser acceptance but the repo has no implemented extension E2E harness.
- Second pass: module fakes are the immediately available deterministic seam and must not be mislabeled browser E2E.
- Evidence: only Vitest module tests exist under the Chrome extension; root `e2e` has no package implementation. `puppeteer-core` is already installed as a Chrome-extension dependency.
- Disposition: **patched**. Keep fake Executor/page integration for deterministic state logic and add a real unpacked-extension Puppeteer run with a Node HTTP fixture server and the configured MiniMax model. No new dependency or production test-mode branch.

### 7. Skill values across cold recovery

- Host/upstream: specified memory-only Skill values but did not define interrupted-run behavior.
- Second pass: persisting resolved values violates the privacy contract; silently resuming without them is impossible.
- Evidence: favorites currently store literal prompt content (`packages/storage/lib/prompt/favorites.ts:23-57`), so the new union must enforce the stronger rule.
- Disposition: **patched**. Interrupted Skill runs ask for inputs again and replan; they do not persist resolved values.

## Result

- Divergences: 7
- Resolved by direct code evidence: 6
- Conceded sequencing improvement: 1
- Debates: 0 (independent peer runtime timed out)
- Escalated: 0

The merged `spec.md` has no unresolved product decision and may proceed to implementation planning.
