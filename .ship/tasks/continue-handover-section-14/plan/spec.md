# Spec

## Product sentence

Navigator stays on a real content page even when an extension page is the active Chrome tab.

## Acceptance

- `BrowserContext.getCurrentPage()` skips an active `chrome-extension://` tab when an allowed content tab exists.
- `BrowserContext.getTabInfos()` does not expose forbidden tabs to the Navigator prompt.
- Existing URL/firewall policy remains the single source of truth.
- Targeted tests, extension type-check, production build, and one main-Chrome side-panel task pass.

## Validated attachment seam addendum

Validated against `4a97364389201a1440dd57711e5a04cc1caa4054` on 2026-07-13.

### Problem

The existing guards validate Chrome tab snapshots before Page construction, but attachment is asynchronous. A tab can become forbidden after the last snapshot and before `attachPage()` or `_currentTabId` assignment. In addition, a pending-only HTTPS tab passes BrowserContext policy while `_getOrCreatePage()` constructs `Page` from its empty committed `tab.url`, leaving it non-attachable.

### Design

- Keep `isUrlAllowed()` as the only URL-policy source.
- Put latest-snapshot acquisition, pending commit waiting, Page construction/reuse, attachment-result checking, post-attachment revalidation, failure cleanup, and `_currentTabId` assignment behind one private BrowserContext operation.
- A pending-only allowed tab is a candidate, not yet an attachable target. Wait for Chrome to expose a committed URL, then refetch and validate it before Page construction. Do not initialize Page from `pendingUrl`.
- `about:blank` is the sole non-attached exception: preserve it only as the existing `navigateTo()` bootstrap. If that same tab commits an HTTP URL, rebuild Page from the HTTP snapshot and require attachment before returning it.
- After attachment, refetch the tab. If either committed or pending URL is forbidden, synchronously remove BrowserContext ownership, clear the current-tab marker, detach Puppeteer, and throw `URLNotAllowedError`.
- Assign `_currentTabId` in the same synchronous continuation as the successful post-attachment check. Callers must not perform a later, separate current-page assignment.
- Capture the current tab ID before any await and use that local throughout lookup and cleanup. Clear it only if `_currentTabId` still equals the captured ID; if another operation selected a different tab, restart against that newer selection instead of overwriting it.
- Concurrent explicit acquisitions (`switchTab()`/`openTab()`) remain last-successful-completion-wins, but each completion must independently pass its own post-attachment policy check. Cleanup for one tab must never clear or detach a different current tab.
- Remove the unused public `updateCurrentTabId()` setter and make the attach-only seam private or eliminate it. Repository search shows no caller, and neither callers nor tests may bypass the validated attachment operation.
- Route the existing background `chrome.tabs.onUpdated` listener through one public BrowserContext lifecycle method before DOM-script injection. A forbidden update removes and detaches the managed page and clears current selection, covering transitions that happen after the attachment operation returns.
- Do not add a factory, port, dependency, or new policy layer. Chrome tabs and Page's Puppeteer methods remain the existing runtime boundaries.

### Consumers and compatibility

- `getCurrentPage()`, `switchTab()`, `openTab()`, and the Chrome-update fallback path in `navigateTo()` must all use the single attachment operation.
- Navigator actions, screenshots, replay, no-highlight, and browser-state prompt construction continue consuming the existing public BrowserContext API.
- `getTabInfos()` keeps reporting an allowed `pendingUrl` for inventory purposes, while attachment waits for the committed URL.
- The existing pre-switch rejection remains in place so a known forbidden tab is never activated.

### Acceptance

- Cold selection and `switchTab()` refetch after asynchronous attachment; a newly forbidden snapshot is rejected and detached before it can become the current page.
- No event interleaving can leave `_currentTabId` pointing at a page that BrowserContext has already invalidated.
- An allowed pending-only tab is not constructed from an empty URL; it is attached only after an allowed committed URL exists.
- A managed content tab that later becomes forbidden is detached and cleared through the background `tabs.onUpdated` lifecycle hook.
- HTTP attachment failure is observable and cannot produce a selected-but-unattached Page; the explicit `about:blank` bootstrap remains navigable.
- Timeout while waiting for a pending-only candidate to commit fails closed without caching or selecting the candidate.
- Existing extension-tab selection, mixed committed/pending, inventory filtering, and activation-race regressions remain green.
- Daily runtime and scion copies have zero diff for every changed runtime file.
- Targeted BrowserContext tests, full chrome-extension tests, lint, type-check (or its already-recorded unrelated baseline failure), and production build complete with recorded evidence.
- Main-Chrome side-panel E2E runs if the approved browser surface permits it; otherwise the existing extension-URL automation policy block is recorded without an unsafe workaround.
