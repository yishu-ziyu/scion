# Browser action runtime — second-pass peer specification

> WARNING: Second spec was self-generated, not independent. Two independent peer dispatches were timeboxed and interrupted before producing an artifact. This pass deliberately used a contradiction, coverage, caller, and ambiguity scan over code paths not emphasized by the host investigation.

## Problem

The existing extension can navigate and interact, but it has no durable authority for task state, side effects, or completion. A side-panel port owns the in-memory Executor; Planner `done` becomes success; all actions execute directly; raw histories can replay form values and stale indexes. The first cycle must create one trustworthy browser-task loop without replacing Chrome or the existing Agent stack.

## Independent code findings

### Lifecycle and command routing

- `currentExecutor` and `currentPort` are global background state (`projects/yishu-browser/chrome-extension/src/background/index.ts:25-28`). `new_task` and follow-up await long-running execution inside the Port listener (`index.ts:105-145`), while pause/cancel mutate the same object (`index.ts:147-163`).
- The side panel sends a `tabId` (`projects/yishu-browser/pages/side-panel/src/SidePanel.tsx:573-630`), but background validation never switches BrowserContext to that tab before constructing Executor (`index.ts:113-121`). Task start must bind the declared tab explicitly.
- Port disconnect cancels the task (`index.ts:274-279`). This must become an `interrupted` transition plus Executor abort; otherwise closing the UI is indistinguishable from user cancellation.
- The side panel's booleans infer task state from legacy events (`SidePanel.tsx:24-44`, `150-188`). Reconnect needs a typed `get_active_task` snapshot instead of replaying UI guesses.

### Executor and completion

- Executor creates all agents/actions internally (`projects/yishu-browser/chrome-extension/src/background/agent/executor.ts:41-97`), so TaskManager needs a small injected factory function and hooks; a factory class or general plugin system is unnecessary.
- Planner `done` directly becomes success (`executor.ts:116-128`, `163-190`). Navigator's `done` action ignores its `success` value when setting `isDone` (`projects/yishu-browser/chrome-extension/src/background/agent/actions/builder.ts:155-162`). Both are completion candidates only.
- `execute()` returns `void` and catches failures (`executor.ts:135-237`). It must return a typed terminal/yield outcome and expose a pre-action plan hook so criteria can freeze before the relevant action.
- Planner currently declares no completion criteria (`projects/yishu-browser/chrome-extension/src/background/agent/agents/planner.ts:21-47`). Its prompt also treats login/credentials as `done` (`prompts/templates/planner.ts:32-48`); Navigator suggests solving CAPTCHA and also exits through `done` for login (`prompts/templates/navigator.ts:62-69`, `121-124`). These must yield `waiting_user`.

### Action execution and safety

- Both live and history execution converge on `NavigatorAgent.doMultiAction()` (`projects/yishu-browser/chrome-extension/src/background/agent/agents/navigator.ts:195-205`, `498-544`). It directly invokes `Action.call()` and logs raw args (`navigator.ts:366-441`). This is the root seam for one dispatcher.
- `Action.call()` already performs Zod validation (`projects/yishu-browser/chrome-extension/src/background/agent/actions/builder.ts:44-72`). Split it into parse plus parsed execution so ActionDispatcher reuses, rather than duplicates, validation.
- Click handlers resolve indexed DOM nodes (`builder.ts:223-277`); Enter has no target metadata (`builder.ts:568-579`). EffectPolicy must use a target snapshot, including active-element/form metadata for Enter. Model `intent` can support but never override DOM-derived risk.
- BrowserContext already owns URL policy and tab identity (`projects/yishu-browser/chrome-extension/src/background/browser/context.ts:32-59`, `276-341`). Keep this authority; do not add another allow-list.

### Privacy and replay

- Raw replay has callers in side panel, background, Executor, Navigator, settings, and storage (`SidePanel.tsx:400-531`; `index.ts:235-259`; `executor.ts:228-235`, `368-440`; `navigator.ts:461-627`; `projects/yishu-browser/packages/storage/lib/chat/history.ts:32-49`, `228-250`). Removing only the background command leaves both a data leak and dead UI.
- Chat deletion clears messages but does not remove `chat_agent_step_*` keys (`chat/history.ts:156-163`). A one-time prefix-key cleanup is required using `chrome.storage.local.get(null)` and `remove`.
- Action logs/events interpolate values: `input_text`, `send_keys`, action-arg error logs, and development history are direct leaks (`builder.ts:279-295`, `568-577`; `navigator.ts:366-370`, `437-442`; `executor.ts:224-232`). Typed task events must contain only redacted summaries.
- Raw user instructions may already be retained in chat (`SidePanel.tsx:128-147`, `598-605`). Task storage should reference that message and store a redacted summary rather than make a second durable copy of field values.

### Reusable storage/UI and media surface

- `createStorage` already provides local get/set/subscribe (`projects/yishu-browser/packages/storage/lib/base/base.ts:59-156`). One background writer is enough; no repository interface or lock service is justified.
- Favorites already provide the single local catalog and stable CRUD surface (`projects/yishu-browser/packages/storage/lib/prompt/favorites.ts:23-57`, `62-205`; `SidePanel.tsx:731-810`). Extend entries to a prompt/Skill union; do not create a second catalog.
- `Page` has fixed Puppeteer evaluation methods (`projects/yishu-browser/chrome-extension/src/background/browser/page.ts:341-438`, `441-483`) but no HTML media control. Add fixed site-neutral observation/control there. Do not emit or execute generated JavaScript.
- The Chrome-extension package has Vitest and only module tests today (`projects/yishu-browser/chrome-extension/package.json:10-15`; `src/background/browser/__tests__/context.test.ts:1-43`). There is no implemented extension E2E harness. Deterministic journey coverage must therefore run through TaskManager with fake Executor/page adapters, followed by real Chrome owner acceptance.

## Minimum design

1. Delete raw replay and its settings/UI first, retaining one prefix-key migration function.
2. Add persisted task/round/command/event types and a concrete local task store in `packages/storage`; command acknowledgements are stored by command ID so duplicates return the original result after restart.
3. Make `background/task/manager.ts` the deep module. Its only caller surface is `dispatch`, `snapshot`, `subscribe`, and `interruptActive`. It owns one command queue, revision checks, Executor creation, recovery, approvals, evidence, and receipts.
4. Move existing Executor construction from `background/index.ts` to one production factory function. Tests inject a function returning a deterministic driver; do not add a class hierarchy.
5. Add one ActionDispatcher at `doMultiAction`; EffectPolicy is an internal pure function. Approval waits in memory while alive, but only redacted identity/fingerprint persists. A cold approval cannot replay missing raw args and must replan.
6. Add a pure CompletionChecker and fixed Page observation probes. Planner proposes criteria; TaskManager assigns round/target/baseline/freshness, rejects criteria copied from user field values, and freezes them before action execution.
7. Add generic media observation/control through Page and the normal dispatcher. Follow-up creates a round but reuses the last valid target reference.
8. Extend favorites to a discriminated prompt/Skill union. Skill placeholders declare string inputs; resolved values exist only in memory and an interrupted Skill run asks for them again.

## Required file surface

Create or fill:

- `projects/yishu-browser/packages/storage/lib/task/{types,runtime,index}.ts`
- `projects/yishu-browser/chrome-extension/src/background/task/manager.ts`
- `projects/yishu-browser/chrome-extension/src/background/task/action-dispatcher.ts`
- `projects/yishu-browser/chrome-extension/src/background/task/completion.ts`
- focused tests under `chrome-extension/src/background/task/__tests__/`
- `projects/yishu-browser/chrome-extension/src/background/agent/factory.ts`
- one side-panel task-status/approval/receipt component if keeping it inside `SidePanel.tsx` would further enlarge its 1,194-line mixed responsibility.

Modify existing integration points:

- storage exports, chat history migration, favorites union;
- background index, Executor, Navigator, Planner schema/prompt, action builder/schemas;
- BrowserContext/Page observation and media methods;
- SidePanel, ChatInput, BookmarkList, options replay setting, locale strings.

Do not create repositories, event buses, generated-script runners, site adapters, multi-task schedulers, marketplace modules, or cloud/browser abstractions.

## Acceptance criteria

1. Start/follow-up/pause/resume/cancel/confirm/approve/reject are serial, revision-checked, idempotent, and ACK without waiting for LLM/page work.
2. Reconnect returns the persisted task snapshot. A stored running task without a live Executor recovers as `interrupted`; a cold `executing` commit recovers as `waiting_user/uncertain`.
3. Click-submit and Enter-submit both stop at the same approval policy. Approval is one-use, page-fingerprint-bound, consumed before execution, and cannot replay after a crash.
4. Planner/Navigator completion candidates cannot produce `completed` without fresh current-round/current-target evidence. Old-baseline, old-round, stale-revision, wrong-criterion, and duplicate confirmation cases fail closed.
5. Login/CAPTCHA yields `waiting_user`, never success and never automated credential entry.
6. Runtime storage/events/logs/analytics/receipts contain no field values, Skill values, credentials, screenshots, full page bodies, DOM nodes, or element indexes. All legacy `chat_agent_step_*` keys are removed and no replay caller remains.
7. Generic HTML media play/pause binds the same target through follow-up and verifies the resulting state without site-specific code.
8. A verified task saves as a semantic local Skill; changed inputs and reordered fixture elements replan successfully, and no resolved values persist.
9. Existing BrowserContext and guardrail tests stay green; task tests cover restart injection at every commit boundary; type checks/build pass or record only pre-existing unrelated failures.

## Test plan

- Vitest pure tests: recovery reducer, command queue/idempotency, EffectPolicy, redaction/digests, CompletionChecker, placeholder/input validation.
- Vitest integration: fake Executor plus fake page through TaskManager for form approval/evidence, media follow-up, Skill rerun, Port message mapping, and reconnect snapshot.
- Restart injection: persist after `proposed`, `approved`, `executing`, and `observed`, reconstruct TaskManager, assert no duplicate execute call.
- Storage inspection: seed raw history/value sentinels, run migration/journeys, inspect `chrome.storage.local` and emitted TaskEvents for absence.
- Real Chrome: fixed Feishu and Bilibili protocols, 10 runs each, with product/model/site/login/environment classification.

## Risks and stop conditions

- Main-frame media access may not reach Bilibili's active player. If generic frame traversal cannot observe it, stop M3 and redesign the generic Page seam; do not add Bilibili selectors.
- Feishu may expose no stable success text or URL. Use a predeclared `user_confirmed` criterion rather than model assertion.
- The current repo has no runnable extension E2E harness. Do not claim automated browser E2E from module fakes; retain real Chrome evidence as a separate required gate.
- `chrome.storage.local` is not transactional, but one background writer plus the TaskManager queue is sufficient for cycle 1. Revisit only if parallel writers/tasks are introduced.
