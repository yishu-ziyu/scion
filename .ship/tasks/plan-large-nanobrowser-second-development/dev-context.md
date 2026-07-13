# Development Context

## Working surface

- Repository: `/Users/mahaoxuan/Desktop/AI产品经理/自研产品/scion`
- Product package: `projects/nanobrowser`
- Runtime: Node `22.12.0` from `.nvmrc`, pnpm `10.26.2`
- Product contract: `plan/spec.md`
- Implementation plan: `plan/plan.md`
- Architecture decision: `docs/design/001-browser-action-task-runtime.md`
- Local conduct: `projects/nanobrowser/AGENTS.md` and `projects/nanobrowser/CLAUDE.md`

## Execution shape

The seven stories execute sequentially because they share the TaskManager, Executor, background service worker, storage types, and SidePanel. Each story follows red -> green -> scoped checks -> atomic commit(s) -> fresh peer review. The final wave runs the repository acceptance surface.

## Test commands

```bash
source "$HOME/.nvm/nvm.sh" && nvm use 22.12.0
pnpm turbo ready
pnpm -F chrome-extension test
pnpm -F chrome-extension type-check
pnpm -F @extension/sidepanel type-check
pnpm -F @extension/storage type-check
pnpm type-check
pnpm build
```

Targeted Vitest files run with `pnpm -F chrome-extension test -- <path>` from `projects/nanobrowser`.

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
