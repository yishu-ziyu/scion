# Plan

## Story: attach only a committed, currently allowed browser target

Files:

- `projects/nanobrowser/chrome-extension/src/background/browser/context.ts`
- `projects/nanobrowser/chrome-extension/src/background/index.ts`
- `projects/nanobrowser/chrome-extension/src/background/browser/__tests__/context.test.ts`
- `/Users/mahaoxuan/projects/nanobrowser/chrome-extension/src/background/browser/context.ts`
- `/Users/mahaoxuan/projects/nanobrowser/chrome-extension/src/background/index.ts`
- `/Users/mahaoxuan/projects/nanobrowser/chrome-extension/src/background/browser/__tests__/context.test.ts`
- `reports/nanobrowser/2026-07-13-minimax-e2e-cdp.md`

### Red

- [ ] Extend the Chrome tabs mock with `onUpdated` and model successive `tabs.get()` snapshots.
- [ ] Add a public-seam cold-selection test where the candidate is allowed before attachment and forbidden on the post-attachment refetch; expect `URLNotAllowedError`, Page detachment, and no reusable current target.
- [ ] Add the equivalent `switchTab()` attachment-race test.
- [ ] Replace the old pending-only assertion with a test whose first `tabs.get()` returns `{ url: '', pendingUrl: 'https://example.com/loading' }`, whose controlled `onUpdated` callback then commits `https://example.com/final`, and whose `Page.prototype.attachPuppeteer` spy asserts `this.url() === 'https://example.com/final'`; also assert attach is not called before the update callback is released.
- [ ] Add a lifecycle test proving a managed page is detached and current selection cleared when `handleTabUpdated()` receives a forbidden tab snapshot.
- [ ] Add an attachment-failure test where `Page.prototype.attachPuppeteer` first returns false; expect `Error('Failed to attach to tab 2')`, then make it return true and call `getCurrentPage()` again, proving a second attach occurs and the failed candidate was neither cached nor selected.
- [ ] Add a current-ID interleaving test: acquire tab A, start `handleTabUpdated(forbidden A)` with `detachPuppeteer` held by a deferred Promise, successfully `switchTab(B)` before releasing A's detach, then assert `getCurrentPage()` returns B and B was neither cleared nor detached.
- [ ] Run `pnpm -F chrome-extension exec vitest run src/background/browser/__tests__/context.test.ts` in `/Users/mahaoxuan/projects/nanobrowser` and record the expected failures before implementation.

### Green

- [ ] In `BrowserContext`, add one private operation that refetches by tab ID, waits for a pending-only candidate to commit, validates committed and pending URLs through `_getAllowedTabUrl()`, creates/reuses the Page from committed Chrome state, requires attachment success, refetches after attachment, invalidates on failure, and commits `_currentTabId` before returning.
- [ ] Make invalidation remove the page and clear `_currentTabId` before awaiting Puppeteer detach so concurrent invalidations cannot retain or double-own the target.
- [ ] Capture `_currentTabId` before awaits and compare before clearing; restart `getCurrentPage()` if old-tab cleanup observes a newer current tab. Concurrent explicit `switchTab()`/`openTab()` acquisitions remain last-successful-completion-wins, with an independent post-attach policy check immediately before each synchronous commit.
- [ ] Route `getCurrentPage()`, `switchTab()`, `openTab()`, and `navigateTo()`'s reattachment branch through the private operation; remove their separate attachment/current-ID commits.
- [ ] Remove the unused `updateCurrentTabId()` setter and eliminate or privatize the attach-only public seam so application code and tests cannot bypass validation.
- [ ] Add `handleTabUpdated(tab)` as the narrow public lifecycle seam and call it at the start of the existing background `chrome.tabs.onUpdated` listener.
- [ ] Keep the existing early switch rejection and inventory policy unchanged.
- [ ] Run the targeted test command until green.

### Refactor and sync

- [ ] Run `pnpm -F chrome-extension exec prettier --write src/background/browser/context.ts src/background/index.ts src/background/browser/__tests__/context.test.ts` in the daily runtime, then require `git diff --check` to pass and `git diff --stat` to contain only the three enumerated runtime files before syncing.
- [ ] Copy the three runtime files from `/Users/mahaoxuan/projects/nanobrowser` to scion and prove `diff -q` is silent for each file.

### Verification and durable closeout

- [ ] In the daily runtime run `pnpm -F chrome-extension exec vitest run src/background/browser/__tests__/context.test.ts`.
- [ ] In the daily runtime run `pnpm -F chrome-extension test`.
- [ ] In the daily runtime run `pnpm -F chrome-extension lint`.
- [ ] In the daily runtime run `pnpm -F chrome-extension type-check`; if it fails only at the recorded pre-existing `helper.ts:24` `completionWithRetry` mismatch, preserve the exact output as a baseline concern.
- [ ] In the daily runtime run `pnpm -F chrome-extension build`.
- [ ] After the implementation commit, dispatch a fresh read-only reviewer with the story acceptance criteria and commit SHA. It must run the targeted test, read all three changed runtime files, and return `PASS`, `PASS_WITH_CONCERNS`, or `FAIL` with file:line triggers; proceed only on PASS or PASS_WITH_CONCERNS with no P1/P2 correctness finding, record concerns, and allow at most two FAIL fix/review rounds.
- [ ] Run the main-Chrome side-panel task only through an approved browser-control surface. Do not navigate automation directly to extension URLs or bypass the tool's safety policy.
- [ ] Update the dated report with changed files, red/green evidence, full verification, twin-diff evidence, review result, E2E result or explicit policy skip, and remaining concerns.
- [ ] Commit scion code and documentation in coherent commits; push only after acceptance evidence is complete.
