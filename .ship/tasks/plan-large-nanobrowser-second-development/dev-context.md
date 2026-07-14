# Development Context

## Working surface

- Repository: `/Users/mahaoxuan/Desktop/AI产品经理/自研产品/scion`
- Product package: `projects/chijie-browser`
- Runtime: Node `22.12.0` from `.nvmrc`, pnpm `9.15.1` through Corepack (the user-level pnpm 10 binary requires a newer Node)
- Product contract: `plan/spec.md`
- Implementation plan: `plan/plan.md`
- Architecture decision: `docs/design/001-browser-action-task-runtime.md`
- Local conduct: `projects/chijie-browser/AGENTS.md` and `projects/chijie-browser/CLAUDE.md`

## Execution shape

The seven stories execute sequentially because they share the TaskManager, Executor, background service worker, storage types, and SidePanel. Each story follows red -> green -> scoped checks -> atomic commit(s) -> fresh peer review. The final wave runs the repository acceptance surface.

## Test commands

```bash
source "$HOME/.nvm/nvm.sh" && nvm use 22.12.0
corepack pnpm turbo ready
corepack pnpm -F chrome-extension test
corepack pnpm -F chrome-extension type-check
corepack pnpm -F @extension/sidepanel type-check
corepack pnpm -F @extension/storage type-check
corepack pnpm type-check
corepack pnpm build
```

Targeted Vitest files run with `pnpm -F chrome-extension test -- <path>` from `projects/chijie-browser`.

## Baseline recorded on 2026-07-13

- `pnpm -F chrome-extension test`: 32 tests pass.
- `pnpm -F @extension/sidepanel type-check`: passes.
- `pnpm -F @extension/storage type-check`: passes.
- `pnpm -F chrome-extension type-check`: pre-existing failures at `src/background/agent/helper.ts:24` (`completionWithRetry`) and `src/personal/bootstrap.ts:4` (missing local-only `secrets.local`). Story checks must not add failures.

## Existing seams and pattern references

- Storage: `packages/storage/lib/chat/history.ts`, `packages/storage/lib/settings/generalSettings.ts`, `packages/storage/lib/settings/favorites.ts`
- Background lifecycle: `chrome-extension/src/background/index.ts`, `chrome-extension/src/background/task/manager.ts`
- Action runtime: `chrome-extension/src/background/agent/executor.ts`, `chrome-extension/src/background/agent/agents/navigator.ts`, `chrome-extension/src/background/agent/actions/builder.ts`
- Browser observation: `chrome-extension/src/background/browser/page.ts`, `chrome-extension/src/background/browser/__tests__/context.test.ts`
- Security tests: `chrome-extension/src/background/services/guardrails/__tests__/guardrails.test.ts`
- Side-panel interaction: `pages/side-panel/src/SidePanel.tsx`, `pages/side-panel/src/components/ChatInput.tsx`, `pages/side-panel/src/components/BookmarkList.tsx`
- Extension build/fixture entry: `chrome-extension/package.json`, `chrome-extension/scripts/inject-personal-secrets.mjs`

## Story boundaries

1. Delete replay storage, command/UI surfaces, and value-bearing action logs before adding durable task state.
2. Add one concrete task store, one TaskManager, revisioned commands, reconnect snapshots, and a minimal status card.
3. Route every action through one persisted dispatcher; external commits require a consumable approval and uncertain recovery.
4. Freeze completion criteria before action, observe after action, and complete only with fresh matching evidence.
5. Add generic HTML media discovery and control through the same dispatcher and completion checker.
6. Save only semantic, parameterized local Skills; never store selectors, indexes, credentials, or generated scripts.
7. Exercise the unpacked extension against deterministic local form/media fixtures and harden only failures found there.

## Non-negotiable constraints

- No raw action arguments, DOM bodies, form values, credentials, or key sequences in persisted state or logs.
- No replay compatibility wrapper, browser fork, cloud runtime, site adapter, parallel task scheduler, repository layer, generated-script runner, or Skill marketplace.
- Existing security guardrails, input validation, approval gates, and completion checks may not be weakened for simplicity.
- No new dependency is planned or authorized.

## Story 1 completion record

- Outcome: removed the replay UI/command/settings/execution/storage surface and migrated legacy `chat_agent_step_*`, `__last_llm_raw`, and `__last_llm_parse_error` keys without touching user chat keys.
- Security hardening: redacted input, keyboard, dropdown, action-error, model-response, JSON-repair, and credential-prefix logs; static regression coverage scans every repaired layer.
- Commits: `444bc94`, `73da123`, `a00e0b5`, `d77b278`, `f3ff8e0`, `8f22e4c`.
- Verification: `chrome-extension` 34/34 tests pass; sidepanel, options, and storage type checks pass; replay search returns only migration/test references.
- Independent review: PASS after two fix rounds. The reviewer found and verified removal of low-level keyboard, raw LLM-response, and dropdown form-value traces.
- Unchanged baseline: chrome-extension type-check still reports only `helper.ts:24` (`completionWithRetry`) and missing local-only `personal/secrets.local`.

## Story 2 completion record

- Outcome: routed start, follow-up, pause, resume, cancel, disconnect interruption, cold recovery, and reconnect through one persisted revisioned TaskManager snapshot.
- Runtime hardening: serialized Executor creation, revalidated task status/current round before `run()`, discarded stale drivers, and prevented cold or disconnected side panels from issuing commands before loading the active snapshot.
- Commits: `6c67cbf`, `fa734f1`, `09a91c0`, `2008ac2`, `25afe7f`, `ebb5b6d`, `2f6aa93`, `c4fd2d9`.
- Verification: `chrome-extension` 43/43 tests pass; manager lifecycle 9/9; sidepanel and storage type checks and scoped ESLint pass.
- Independent review: PASS after two fix rounds. The reviewer verified closure of Executor launch races, cold active-task recovery, and live side-panel reconnection.
- Unchanged baseline: chrome-extension type-check still reports only `helper.ts:24` (`completionWithRetry`) and missing local-only `personal/secrets.local`.

## Story 3 completion record

- Outcome: routed every live Navigator action through one crash-safe dispatcher with parse-before-policy ordering, redacted persisted attempts, one-use approval, target revalidation, and exactly-once handler invocation.
- Safety hardening: fail-closed ambiguous clicks and Enter variants; bound approval to live structural and semantic target digests; converted uncertain post-commit errors, disconnects, and cold `executing` attempts to `waiting_user/commit_outcome_uncertain`; isolated concurrent side-panel ports.
- Privacy hardening: redacted Navigator action/step and Planner step events before emission, removed full Planner output logging, and prevented all action telemetry from entering durable chat history.
- Commits: `f7a4414`, `23b1af0`, `e76b21e`, `ce14eb8`, `4a6bf91`, `893b424`, `9677f43`, `fe6281d`.
- Verification: `chrome-extension` 107/107 tests pass; sidepanel and storage type checks and scoped ESLint pass; static review confirms the dispatcher remains the only production Action handler execution seam.
- Independent review: PASS after two fix rounds. The reviewer verified approval consumption and target mutation handling, uncertain recovery, multi-port isolation, fail-closed link policy, and event/history/log privacy boundaries.
- Unchanged baseline: chrome-extension type-check still reports only `helper.ts:24` (`completionWithRetry`) and missing local-only `personal/secrets.local`.

## Story 4 completion record

- Outcome: Planner success is now only a completion candidate; TaskManager freezes redacted criteria before action, binds baseline and evidence to the actual tab/round, and creates `completed` only through a verified immutable receipt or dedicated user confirmation.
- Runtime hardening: one serial Executor runner carries explicit round IDs through Planner, Navigator and dispatcher hooks; running, waiting and completed follow-ups preserve model memory and hand off at safe action/probe boundaries without concurrent BrowserContext cleanup or lost rounds.
- Evidence hardening: missing, baseline-true, stale, timed-out, wrong-round and wrong-target observations fail closed; unavailable probes get one bounded retry; multiple explicit confirmations persist independently; automatic and user evidence combine without duplication.
- UI/event hardening: task events carry top-level task/round/revision identity, SidePanel rejects stale or unrelated snapshots, and every unresolved `user_confirmed` criterion has its own command button.
- Commits: `474f944`, `f2667a6`, `e80c205`, `688916e`, `3c84e98`, `f8bac9f`, `d3b9eb8`, `2d2bb1b`.
- Verification: `chrome-extension` 137/137 tests pass; focused completion/form/manager/browser/event coverage passes; sidepanel and storage type checks and scoped ESLint pass.
- Independent review: PASS after two fix rounds. The reviewer verified actual-tab evidence binding, multi-confirmation progress, event revision guards, preserved Executor memory, safe follow-up boundaries, and late-probe round handoff.
- Unchanged baseline: chrome-extension type-check still reports only `helper.ts:24` (`completionWithRetry`) and missing local-only `personal/secrets.local`.

## Story 5 completion record

- Outcome: added site-neutral main-frame HTML5 audio/video play and pause through the shared dispatcher, with deterministic visible-media selection and SHA-256 target fingerprints that exclude page text, titles, and URL queries.
- Continuity hardening: the most recently controlled media target moves to the durable recency tail, omitted follow-up digests rebind to that target, and missing or ambiguous targets stop in explicit `waiting_user` states instead of guessing.
- Evidence hardening: Planner `media_state` criteria remain machine-verifiable, bind to the latest stored media digest before baseline observation, and require fresh current-round/current-target page state before receipt creation.
- Commits: `b4c61eb`, `6dce44c`.
- Verification: `chrome-extension` 149/149 tests pass; focused media/manager/completion/dispatcher review passes 76/76; sidepanel and storage type checks and scoped ESLint pass; static search finds no site-specific runtime logic.
- Independent review: PASS after one fix round. The reviewer verified deterministic selection/digesting, wait-state behavior, target recency, Planner-to-criterion binding, and same-round target/freshness verification.
- Unchanged baseline: chrome-extension type-check still reports only `helper.ts:24` (`completionWithRetry`) and missing local-only `personal/secrets.local`.

## Story 6 completion record

- Outcome: verified local semantic Skills — parameterized templates in favorites union, save only from completed rounds with receipts, run with values only in memory, criteria locked from Skill definition, cold recovery to `inputs_required/skill_inputs_required`.
- Storage: `parseSkillInputs` / `compileSkillTemplate` / `assertExactSkillInputs` / `createSkillDefinition` / `addSkill` / `getSkill` in `packages/storage/lib/prompt/favorites.ts`.
- Runtime: `TaskManager.saveSkill` + `runSkill` + `freezeSkillCriteria` + locked criteria rounds; no resolved values in persisted task snapshots.
- UI: `TaskStatusCard` `skill-save` / template form; `BookmarkList` run + per-input fields; draft cleanup helpers.
- Privacy/safety follow-ups: reject unsafe criteria/templates; no secret-like placeholders; clear skill input drafts after send.
- Commits: `530e31b`, `de1f89b`, `3322ed9`, `6537efe`, `3730a4f`.
- Verification (2026-07-14 re-run): `skill-journey` 7/7, `form-journey` 10/10, `replay-migration` 2/2; `@extension/storage` and `@extension/sidepanel` type-check pass.
- Process: plan.md Story 6 steps marked complete; independent peer review dispatched this session.
- Unchanged baseline: chrome-extension type-check still reports only `helper.ts:24` (`completionWithRetry`) and missing local-only `personal/secrets.local`.

### Story 6 fix round (2026-07-14)

- Peer: PASS_WITH_CONCERNS (cold-save templates; residual UI for inputs_required).
- Fix commit: persist skill save meta outside TaskSession (`task-skill-save-v1`).
- Re-verification: skill-journey 8/8, form-journey 10/10, manager 21/21, replay-migration 2/2; storage + sidepanel type-check pass.
- Concerns residual: see `concerns.md`.

## Story 7 progress (2026-07-14)

- Outcome so far: fixture e2e runner + selectors exist; RUNS=1 full journey passed once; multi-run/media still model-flaky under MiniMax.
- Product fixes: SidePanel session create when no chatSessionId; planner login_required false-positive guard; e2e fail-fast/reset/goal-send ensure.
- Evidence: `reports/nanobrowser/action-agent-cycle-1.md`
- Commit: `259cb4a`
- Remaining: RUNS=10 green; Feishu/Bilibili owner 8/10; then design status → current.
