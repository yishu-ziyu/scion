# Concerns

- Real side-panel E2E was not rerun because available automation could not safely reload/control the extension UI. Manual reload + example.com summary remains.
- Repository-wide extension type-check has a pre-existing `agent/helper.ts:24` error for `completionWithRetry`.
- Fallback chooses the first allowed tab; track the last allowed activation if multi-tab precision becomes necessary.
- Blocking review finding: committed `chrome-extension://` + allowed HTTPS `pendingUrl` is approved too early. Omit and refuse the tab until the committed URL becomes allowed; cover both inventory and cold-selection behavior in the next fix cycle.
