# Browser action runtime — implementation specification

## Goal

Build one dependable vertical product loop inside the existing extension: a user goal becomes a persisted task, actions execute under a shared safety policy, completion requires observable evidence, follow-up instructions preserve target context, and a verified task can become a reusable local Skill.

## Tracer-bullet stories

### Story 1 — task lifecycle

- Add TaskSession + TaskRound state/storage and a TaskManager interface around the existing Executor.
- Route side-panel background messages through it.
- Add per-task command serialization, revision checks and command-id idempotency.
- Persist before/after transitions and recover stale `running` state as `interrupted`.

Check: deterministic TaskManager tests cover start, follow-up, cancel, interruption, and resume.

### Story 2 — verified form commit

- Add the single ActionDispatcher, EffectPolicy and approval request/response path.
- Persist action attempts through `proposed/approved/executing/observed/uncertain` and add crash-boundary tests.
- Add frozen round/target/baseline/freshness completion criteria, evidence and an immutable receipt.
- Add an explicit `confirm_completion` command and evidence path; normal chat cannot satisfy a user-confirmed criterion.
- Prove click and Enter submit cannot bypass approval.

Check: form fixture completes only after approval and observable success; reject and failed-criterion cases pass.

### Story 3 — continuous media control

- Persist/rebind page and media target references for follow-up commands.
- Add the required site-neutral HTML media action/observation; do not add site-specific logic.

Check: media fixture and real Bilibili play → “暂停这个视频” → `paused=true`.

### Story 4 — local Skill

- Extend the existing favorite prompt surface with optional semantic Skill fields.
- Save only verified tasks; instantiate declared inputs into a new task and replan.

Check: changed inputs and reordered fixture DOM still complete; no old index replay or generated JavaScript.

## Engineering-facing acceptance criteria

- No `completed` state without passed evidence or explicit user confirmation.
- No external commit without a recorded one-use approval.
- No auto-retry when an external commit outcome is uncertain.
- No completion from criteria already true at baseline or observed from the wrong target/round.
- No completion from stale-round, wrong-criterion, stale-revision or duplicate user confirmation.
- Follow-up binds to the existing task and target or explicitly asks for rebinding.
- Side-panel reconnection presents durable state instead of inventing progress.
- Existing security boundaries, BrowserContext regressions, build, and real Chrome workflow remain intact.
- Legacy raw replay is disabled/removed, and runtime-generated storage/events/logs are value-redacted.

## Exclusions

Standalone browser, cloud execution, parallel tasks, native desktop actions, credential/CAPTCHA automation, arbitrary scripts, Skill marketplace, remote sync, enterprise permissions, and billing.

## Canonical design

`docs/design/001-browser-action-task-runtime.md`

## Investigation

Validated against branch `main`, HEAD `0a2599b6a5a84097fb527321c45b573c29622ac5` on 2026-07-13.

### Current call and data paths

- The background entry point owns one global `BrowserContext`, `currentExecutor`, and `currentPort`; `new_task` constructs and awaits an Executor, while follow-up, pause, resume, cancel, and replay reach the same in-memory object (`projects/nanobrowser/chrome-extension/src/background/index.ts:25-28`, `113-163`, `235-259`). Port disconnect currently cancels the Executor (`index.ts:274-279`), so reconnect cannot represent durable progress.
- The side panel creates the chat session ID, queries the active tab, and sends untyped `new_task`/`follow_up_task` messages (`projects/nanobrowser/pages/side-panel/src/SidePanel.tsx:552-631`). It infers running/completed state from local booleans and legacy execution events (`SidePanel.tsx:150-188`, `298-380`) instead of requesting an authoritative task snapshot.
- `Executor` constructs `ActionBuilder`, `NavigatorActionRegistry`, Navigator, and Planner internally (`projects/nanobrowser/chrome-extension/src/background/agent/executor.ts:41-97`). Planner `done=true` directly controls task success (`executor.ts:116-128`, `163-190`). `execute()` catches terminal errors and returns `void` (`executor.ts:135-237`), so TaskManager needs a typed outcome/callback seam rather than parsing UI strings.
- Navigator normalizes model output and routes both normal and history execution through the same private `doMultiAction()` (`projects/nanobrowser/chrome-extension/src/background/agent/agents/navigator.ts:158-220`, `366-459`, `498-544`). That method is the single root execution seam: it currently logs raw arguments and directly calls `Action.call()` (`navigator.ts:366-370`, `386-441`).
- `Action.call()` already owns Zod validation (`projects/nanobrowser/chrome-extension/src/background/agent/actions/builder.ts:44-72`); the dispatcher must reuse that schema instead of duplicating validation. Click, input, tab, and Enter-key effects are implemented in the same action registry (`builder.ts:152-330`, `568-579`).
- `BrowserContext` already enforces allowed URLs and owns tab attachment/switching (`projects/nanobrowser/chrome-extension/src/background/browser/context.ts:32-59`, `148-183`, `276-341`). `Page` already uses fixed Puppeteer `evaluate` calls (`projects/nanobrowser/chrome-extension/src/background/browser/page.ts:341-438`, `441-483`), but no generic HTML media observation/control exists.
- Existing prompts contradict the new task contract: Planner treats login/credentials as `done`, and Navigator suggests attempting CAPTCHA (`projects/nanobrowser/chrome-extension/src/background/agent/prompts/templates/planner.ts:32-48`; `prompts/templates/navigator.ts:62-69`, `121-124`). They must instead yield `waiting_user`; neither condition is completion evidence.
- Existing events expose an unstructured `details` string (`projects/nanobrowser/chrome-extension/src/background/agent/event/types.ts:50-73`), and action handlers/loggers interpolate input values (`projects/nanobrowser/chrome-extension/src/background/agent/actions/builder.ts:279-295`, `568-577`; `navigator.ts:437-442`). New task wire events therefore carry typed, redacted summaries; old agent details remain model-memory-only where necessary and do not become task receipts or analytics.
- Raw replay spans settings, side-panel commands, background routing, Executor, Navigator, and `chat_agent_step_*` storage (`projects/nanobrowser/pages/side-panel/src/SidePanel.tsx:400-531`; `projects/nanobrowser/chrome-extension/src/background/index.ts:235-259`; `executor.ts:228-235`, `368-440`; `projects/nanobrowser/packages/storage/lib/chat/history.ts:32-49`, `228-250`). Removal must cover every caller, the settings toggle, and stored keys.
- Favorites are a concrete local-storage module and UI surface, with stable prompt-only entries (`projects/nanobrowser/packages/storage/lib/prompt/favorites.ts:23-57`, `62-205`; `projects/nanobrowser/pages/side-panel/src/SidePanel.tsx:731-810`; `components/BookmarkList.tsx:6-19`, `83-195`). Extend this union in place; do not add a parallel Skill catalog.
- Current automated coverage is Vitest at the Chrome-extension module seams (`projects/nanobrowser/chrome-extension/src/background/browser/__tests__/context.test.ts:1-43`; `services/guardrails/__tests__/guardrails.test.ts:1-8`). The repo has no implemented browser E2E harness despite the root `e2e` script, so deterministic task journeys must first be executable through TaskManager with fake Executor/page adapters; real Chrome remains the final Feishu/Bilibili acceptance surface.

### Implementation decisions fixed by investigation

1. Keep `TaskManager` as the deep public module with `dispatch`, `snapshot`, and `subscribe`. Use one injected Executor factory function because production Executor and deterministic test Executor are both real adapters; do not add a factory class or a general task framework.
2. Keep concrete Chrome local storage. One background writer owns state, so no repository interface or distributed locking is needed. Put shared persisted task/Skill wire types beside their storage implementation in `packages/storage`.
3. Reuse `Action` Zod schemas by splitting validation from execution (`parse` plus `executeParsed`); the Navigator calls the dispatcher once per action, and no remaining runtime caller may invoke action handlers directly.
4. Yield the Executor at approval or user-wait boundaries through a typed outcome. Approval never holds a raw action across a cold restart: only the redacted action identity/fingerprint persists, and resume replans if the in-memory exact action is gone.
5. Persist element values only as SHA-256 digests when equality evidence is required. Task state, evidence, events, logs, and Skills never store raw form values; `checked`, `disabled`, media state, URL, and visible success text may use their non-secret normalized forms.
6. Add fixed, site-neutral media methods to `Page`; this is trusted extension code, not generated JavaScript. When multiple media elements exist, select the currently playing visible element first, then the largest visible candidate; persist only the tab plus a stable digest/semantic hint.
7. A prototype is not required before planning: the selected seams and Chrome/Puppeteer primitives already exist in the codebase, and no external API assumption remains. The first implementation slice supplies the runnable feedback loop.
8. Keep the existing user-authored chat message as the only durable copy of a raw task instruction. Commands carry the instruction in memory plus its chat-message ID; TaskSession/TaskRound persist only the message reference and a redacted summary. A cold normal-task resume reloads that user message. Resolved Skill input values stay in memory only, so an interrupted Skill run asks for its inputs again instead of persisting them.
9. Store the original `CommandAck` by command ID, not only a processed-ID list, so duplicate commands can return the same acknowledgement after restart. This remains bounded by the single local task history and needs no cache abstraction.
10. Reject a Planner text criterion that copies any user-supplied field value from the current instruction; fall back to URL/state evidence or an explicit `user_confirmed` criterion. This prevents completion contracts from becoming a second value store.
11. The supplied `tabId` is authoritative at `start`: TaskManager calls the existing URL-checked `BrowserContext.switchTab(tabId)` before Executor creation. Follow-up defaults to the stored target and asks before rebinding.
12. Login and CAPTCHA produce a typed `waiting_user` yield. Update both prompts so neither can be translated into `done`, credential entry, or CAPTCHA automation.
13. Add an actual unpacked-extension fixture E2E using the already-installed `puppeteer-core`, a Node standard-library HTTP fixture server, the real configured MiniMax route, and `CHROME_PATH` as the only environment knob. Module fakes cover deterministic runtime logic but do not count as browser E2E; the Chrome run must exercise side panel → background → page → approval/evidence/receipt without a production test-mode branch or new browser dependency.

### Unresolved operational assumptions

- Bilibili may place the active media in a frame or wrap it with site controls. M3 must first test the generic main-frame HTML media path; if the real acceptance fails because the media is inaccessible, stop and revisit the generic frame strategy rather than add Bilibili-specific code.
- Feishu success evidence varies by form. The fixture uses explicit post-submit text/URL evidence; the owner acceptance run must declare its criterion before execution and may fall back to the dedicated user-confirmed criterion when the site exposes no stable observable state.
