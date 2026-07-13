# Spec divergence report

Compared host and independent peer investigations against `4a97364389201a1440dd57711e5a04cc1caa4054`.

## 1. Pending-only Page strategy

- Host: wait for a committed `tab.url`, refetch, then construct Page.
- Peer: initially construct Page from `_getAllowedTabUrl()`'s effective `pendingUrl`.
- Evidence: Page stores its constructor URL as state and derives attachability from it (`page.ts:71-82`), while debugger attachment targets only the tab ID (`page.ts:97-115`). `pendingUrl` may redirect or never commit. BrowserContext already owns a `waitForTabEvents()` path that waits for URL, title, and completion (`context.ts:170-244`).
- Debate: the peer conceded that using `pendingUrl` would misstate committed Page state.
- Disposition: **proven-false**. The merged spec keeps wait-for-commit and fail-closed timeout behavior.

## 2. Selected-but-unattached allowed pages

- Host: `attachPuppeteer() === false` is a failed acquisition and must never become current.
- Peer: initially preserve the existing unattached result for allowed non-web pages such as `about:blank`.
- Evidence: downstream Page operations either degrade to empty/null state (`page.ts:181-199,341-345`) or throw when Puppeteer is absent (`page.ts:441-444,1285-1288`). Only `navigateTo()` has a narrow Chrome-tabs fallback (`context.ts:277-295`), while all other BrowserContext consumers expect an operable Page.
- Debate: the peer conceded that this exception does not justify returning a selected-but-unattached target.
- Disposition: **proven-false**. The merged spec requires observable acquisition failure.

## 3. Concurrent current-tab cleanup

- Host: post-attachment revalidation and current-ID assignment belong in one operation.
- Peer addition: an older operation can still clear or overwrite a newer selection if it rereads mutable `_currentTabId` after awaits.
- Evidence: current logic uses `_currentTabId` on both sides of `chrome.tabs.get()` and detach awaits (`context.ts:135-149`); `removeAttachedPage()` already uses compare-before-clear (`context.ts:335-340`). Repository search finds no caller for the public `updateCurrentTabId()` setter.
- Disposition: **patched**. The merged spec captures tab IDs before awaits, compare-clears, restarts on newer selection, and removes the unused unsafe setter.

## 4. Public attach-only bypass

- Host: callers should use a single validated attachment operation.
- Peer addition: public `attachPage(Page)` lets tests or future callers bypass the safety transaction; the current pending-only test already does so.
- Evidence: the only repository calls to `attachPage()` are inside BrowserContext and test spies (`context.ts:81-95,130,147,264,295,316`; `context.test.ts:79,106,121,133,162`).
- Disposition: **patched**. The merged spec eliminates or privatizes the attach-only seam and moves tests to BrowserContext public behavior plus Page/Chrome system-boundary stubs.
