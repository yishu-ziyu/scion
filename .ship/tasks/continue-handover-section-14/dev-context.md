# Dev Context

## Test Command

`pnpm -F chrome-extension exec vitest run src/background/browser/__tests__/context.test.ts`

## Test Seams

- `BrowserContext.getCurrentPage()`, `switchTab()`, and `handleTabUpdated()` — selected/invalidated page behavior.
- `BrowserContext.getTabInfos()` — tabs exposed to agents.
- Mock only system boundaries: Chrome Tabs API and `Page.prototype.attachPuppeteer`/`detachPuppeteer`; use real BrowserContext, Page construction, and URL policy.

## Code Conduct

- Node 22 / pnpm 9 / Vitest / TypeScript; minimal scoped diff; no new dependency.
- Reuse `isUrlAllowed()`; do not duplicate scheme rules.
- Format only the three changed runtime files; keep generated output and workspace config untouched.
- Do not edit generated output or expose secrets.

## Pattern References

- `chrome-extension/src/background/browser/context.ts`
  - Why analogous: owns every target selection, attachment, cleanup, and BrowserState inventory path in scope.
  - Mirror: private underscore helpers, `URLNotAllowedError`, async Chrome calls, map ownership.
  - Deviation: collapse repeated validate/attach/current commits into one fail-closed private transaction.
- `chrome-extension/src/background/browser/page.ts`
  - Why analogous: existing Page construction and Puppeteer boundary define committed URL state and attachability.
  - Mirror: boolean attachment result and explicit detach cleanup; do not change this file.
- `chrome-extension/src/background/browser/util.ts`
  - Why analogous: authoritative URL/firewall policy already blocks forbidden schemes.
  - Mirror: fail closed and reuse; do not add a second policy.
- `chrome-extension/src/background/browser/__tests__/context.test.ts`
  - Why analogous: public BrowserContext regressions and hoisted Chrome mock already cover the target lifecycle.
  - Mirror: Vitest hoisted boundary mocks, literal fixtures, public-method assertions.
  - Deviation: replace BrowserContext.attachPage spies with Page debugger-boundary spies.
- `chrome-extension/src/background/index.ts`
  - Why analogous: existing `tabs.onUpdated` adapter is the lifecycle entry point.
  - Mirror: forward the full Chrome tab snapshot before the existing DOM injection condition.

## Waves

One vertical story in one sequential wave because context, background adapter, and tests overlap. Host implements; a fresh read-only peer reviews the story commit.

## Verification

- Red → green: pending commit, cold/switch attach races, HTTP attach failure, update invalidation, old cleanup vs new selection, about:blank bootstrap, stale read vs explicit switch, and blank→HTTP promotion.
- `pnpm -F chrome-extension test`: 32/32 pass; BrowserContext targeted suite: 18/18 pass.
- Three-file targeted ESLint: pass. Full lint reports only 13 recorded pre-existing errors outside the changed files.
- `pnpm -F chrome-extension build`: pass.
- Type-check: only the pre-existing `agent/helper.ts:24` `completionWithRetry` error remains.
- Story commits: `2147f01`, `9f164b3`, `33273cc`, `d398209` (plus design/dev evidence commits).
- Peer review: concrete fix rounds addressed about:blank bootstrap compatibility, stale read overwrite, later blank→HTTP promotion, and same-acquisition blank→HTTP promotion. Final narrow verification: PASS, no P1/P2 findings.
