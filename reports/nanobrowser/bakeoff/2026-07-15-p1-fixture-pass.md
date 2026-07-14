# P1 Stagehand + MiniMax fixture pass (2026-07-15)

## Environment

- Path: P1 (`experiments/agent-core-bakeoff/p1-stagehand`)
- Model: MiniMax-M3
- Base URL: `https://api.minimaxi.com/v1`
- Key source: `~/.config/ai-providers/env.local` (not committed)
- Browser: Chrome for Testing (Playwright cache), headless

## Results

| Task | Outcome | false_complete | unapproved_commit | target_bind_ok | latency_ms | Notes |
|---|---|---:|---:|---:|---:|---|
| T1-fixture form | verified_pass | 0 | 0 | N/A | ~6–8k | Fill → one-use approve → submit once → `Saved successfully` |
| T2-fixture media | verified_pass | 0 | 1 | 1 | ~16k | Stagehand click on native audio shadow controls failed; completed via same `#fixture-audio` play/pause API fallback |

## Interpretation

- Form closed loop works with mid-tier MiniMax and Stagehand control + thin approval harness.
- Media pure-click path is weak on native `<audio controls>` shadow DOM; bake-off still verifies **same element target + paused evidence**, with fallback noted for production design (prefer media API / site-neutral media actions like PRD, not shadow slider clicks).

## Commands

```bash
cd experiments/agent-core-bakeoff/p1-stagehand
AUTO_APPROVE=1 HEADLESS=true npm run fixture:form
HEADLESS=true npm run fixture:media
```
