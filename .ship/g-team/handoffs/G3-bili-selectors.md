HANDOFF|task=g3-bili-selectors|status=delivered|files=projects/chijie-browser/chrome-extension/src/background/browser/sites/bilibili-titles.ts,projects/chijie-browser/chrome-extension/src/background/browser/sites/__tests__/bilibili-titles.test.ts,projects/chijie-browser/chrome-extension/src/background/agent/backends/control-llm.ts|tests=pnpm -F chrome-extension test -- src/background/browser/sites/__tests__/bilibili-titles.test.ts:0|unverified=no live bilibili agent re-run; dist not rebuilt; no Chrome kill

# g3-bili-selectors

## Problem
Complex B站 agent → selector_miss. Harvest proved titles exist on `.bili-video-card__info--tit` (home + favlist).

## Fix (minimal)
- Pure helpers in `browser/sites/bilibili-titles.ts`:
  - `isBilibiliListSurface` / `bilibiliListSurfaceKind`
  - `extractBilibiliTitlesFromHtml` (class + title attr)
  - `cleanBilibiliTitles` (drop duration/playcount noise e.g. `7645101:54`)
  - `enrichObserveWithBilibiliTitles` + format block with selector hint
- `control-llm` `buildStateText`: on bili home/favlist, `page.getContent()` → enrich observe lines so model sees real titles.

## Test
```bash
cd projects/chijie-browser
pnpm -F chrome-extension test -- src/background/browser/sites/__tests__/bilibili-titles.test.ts
# exit 0 · 9 tests
```

Also: control-llm-outcome tests still green.
