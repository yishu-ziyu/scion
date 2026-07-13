# Peer spec: make BrowserContext attachment fail closed

Basis: independent inspection at `4a97364389201a1440dd57711e5a04cc1caa4054`; no existing `.ship` spec or plan was read.

## Problem and evidence

- `BrowserContext._getAllowedTabUrl()` deliberately treats `pendingUrl` as the candidate while also rejecting an unsafe committed URL (`context.ts:37-49`). But `_getOrCreatePage()` constructs `Page` with only `tab.url` (`context.ts:51-68`). A pending-only HTTP tab therefore passes selection and is returned by `getCurrentPage()` (`context.ts:107-132`) while `Page` marks the empty committed URL non-attachable (`page.ts:71-83,97-100`). The existing pending-only test hides this blocker by mocking `BrowserContext.attachPage()` (`context.test.ts:129-139`).
- Every new attach validates before the asynchronous debugger connection, then trusts the old snapshot. `attachPage()` awaits `Page.attachPuppeteer()` and immediately caches the page (`context.ts:81-95`); `Page.attachPuppeteer()` itself has multiple awaits (`page.ts:97-120`). `switchTab()` rechecks after activation but still has this final attach-time gap (`context.ts:246-266`).
- Current-tab logic rereads mutable `_currentTabId` after awaits (`context.ts:135-149`). An update during `chrome.tabs.get()` or detach can make the old operation detach/clear/look up a different current tab. `removeAttachedPage()` already demonstrates the required compare-before-clear invariant (`context.ts:331-340`).
- Later navigation events currently only inject scripts; they never tell `BrowserContext` that an attached/current tab has become forbidden (`background/index.ts:42-46`). Removal is wired separately (`background/index.ts:60-63`).
- The context is the high-leverage seam: construction and attachment have no external callers, while `getCurrentPage()`/`switchTab()` have direct callers in `background/index.ts` and many agent actions (direct-caller `rg`). Callers should not learn URL snapshot ordering.

## Required design

Deepen `BrowserContext` around one internal acquire/attach seam (for example `_getOrCreatePage(tab)` expanded into the whole transaction). Its interface to callers remains the existing public `getCurrentPage()`, `switchTab()`, `openTab()`, and navigation methods; do not add a second Page factory or change agent callers.

The transaction must:

1. Validate the supplied tab snapshot with the existing `_getAllowedTabUrl()` policy and retain the returned **effective URL**.
2. Construct `Page` with that effective URL, not `tab.url`. This is the pending-only strategy: an empty committed URL plus allowed HTTP(S) `pendingUrl` becomes attachable, while a forbidden committed URL still blocks the tab because `_getAllowedTabUrl()` checks both values. No `Page` policy fork is needed.
3. Reuse an existing managed page only after the current tab snapshot passes the same policy. For a new page, attempt `attachPuppeteer()`; preserve the existing legitimate unattached result for allowed non-web pages such as `about:blank`.
4. After the attach attempt returns, fetch `chrome.tabs.get(tabId)` and reapply `_getAllowedTabUrl()` before caching or returning the page. This is the attach-time TOCTOU close. On forbidden/missing tabs or attach failure after partial connection: detach the candidate, remove it from `_attachedPages`, compare-and-clear the current ID, and surface `URLNotAllowedError` for a forbidden target (preserve the original error for non-policy failures). Never cache before this validation.
5. Route every internal new-Page path through this seam (`getCurrentPage`, `switchTab`, `navigateTo` reattach, `openTab`). `attachPage(Page)` has no direct external caller and should become private or disappear so callers cannot bypass validation.

Keep `Page` and `util` unchanged unless typing forces a surgical edit: `Page` already accepts the URL snapshot and derives attachability from it (`page.ts:71-83`), and `isUrlAllowed()` is already the shared fail-closed policy (`util.ts:8-92`).

## Event invalidation and current-ID race

Expose one narrow BrowserContext event interface, e.g. `handleTabUpdated(tabId, tab): Promise<void>`. `background/index.ts` forwards every `tabs.onUpdated` event to it before/independently of the existing complete-HTTP script injection. The method owns policy knowledge: if committed/pending state is forbidden, detach and evict that tab and clear `_currentTabId` only when it still equals `tabId`. Do not duplicate URL policy in `background/index.ts`, and log/catch the async handler so injection behavior is not coupled to cleanup failure.

Within `getCurrentPage()`, capture the non-null current ID in a local before the first await; use that ID for get/detach/map lookup, and compare-and-clear it after awaits. If another public operation has selected a different ID, restart against the newer ID rather than overwriting or clearing it. Apply the same compare-and-clear rule to post-attach cleanup and update invalidation. This closes the current-ID race without locks or a new scheduler.

## Public acceptance tests

Extend `browser/__tests__/context.test.ts`; call BrowserContext public methods and stub only the Page/debugger adapter (`Page.prototype.attachPuppeteer`/`detachPuppeteer`) and Chrome tabs API. Add `tabs.onUpdated` to the existing Chrome mock if the integration interface needs it.

1. **Pending-only attach:** `getCurrentPage()` receives `{url: '', pendingUrl: 'https://example.com/loading'}`; it calls the Page attach adapter, returns a `validWebPage`, and does not create a fallback tab. Do not mock `BrowserContext.attachPage`, because that was the false-positive test seam (`context.test.ts:129-139`).
2. **Attach-time swap fails closed:** `switchTab()` sees allowed snapshots through activation, the attach adapter succeeds, then the post-attach `tabs.get()` returns a forbidden committed or pending extension URL. Expect `URLNotAllowedError`, candidate detach, and no later reuse of that candidate.
3. **Allowed post-attach control:** the same sequence with a still-allowed final snapshot returns the page and reuses it without a second debugger attach.
4. **Later update invalidation:** acquire an allowed page, call the public update-event interface with a forbidden snapshot, then verify detach occurs and the next `getCurrentPage()` selects/query-validates another allowed tab.
5. **Current-ID race:** pause old-tab cleanup, select a new tab via `updateCurrentTabId()`, finish old cleanup, and verify the next `getCurrentPage()` reads/returns the new ID. Old cleanup must not clear or detach the new selection.
6. Preserve all existing mixed committed/pending, inventory, fallback, and post-activation cases (`context.test.ts:76-167`).

Acceptance is complete when the focused context test file passes plus the extension TypeScript check, and direct-caller `rg` confirms no public caller can still invoke the old attach-only seam.

## Non-goals

- No generalized navigation monitor, mutex, operation queue, new dependency, or Page rewrite.
- No change to allow/deny semantics beyond using the already-selected effective URL and repeating the policy after attach.
- This closes attachment and invalidation safety only; broader second-development behavior remains separate.
