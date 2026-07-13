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

- Red → green: settled extension tabs, allowed pending web URLs, and pending extension URLs.
- `pnpm -F chrome-extension test`: 23/23 pass.
- Targeted ESLint: pass.
- `pnpm build`: pass.
- Type-check: only the pre-existing `agent/helper.ts:24` `completionWithRetry` error remains.
- Story commits: `0d28641`, `b8327a1`, `641b4ca`.
- Peer review: fail after two targeted fix rounds. Mixed committed/pending snapshots and current-tab reuse are covered; unresolved findings are attach-time snapshot races and pending-only tabs constructing `Page` from empty `tab.url`.
