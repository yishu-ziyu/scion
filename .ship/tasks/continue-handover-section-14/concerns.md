# Concerns

- Real side-panel E2E was not rerun because available automation could not safely reload/control the extension UI. Manual reload + example.com summary remains.
- Repository-wide extension type-check has a pre-existing `agent/helper.ts:24` error for `completionWithRetry`.
- Fallback chooses the first allowed tab; track the last allowed activation if multi-tab precision becomes necessary.
