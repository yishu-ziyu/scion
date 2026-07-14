# M2 progress — production core swap seam

Date: 2026-07-15  
Authority: `docs/design/002`, `docs/product/003` M2 / G6

## Done this slice

| Item | Evidence |
|---|---|
| design/002 written | `docs/design/002-production-core-swap.md` |
| design/001 status corrected | partially-outdated; points to 002 |
| Docs index / README / 004 M2 anchors | updated |
| Multi-backend factory | `chrome-extension/src/background/agent/factory.ts` |
| Nano extracted | `agent/backends/nano.ts` |
| Control script driver | `agent/backends/control-loop.ts` |
| Setting key | `generalSettings.agentCoreBackend` default `nano` |
| Unit + journey tests | vitest backends + control-backend-journey **pass** |

## Acceptance map (design/002)

| # | Status |
|---|---|
| A1 nano/control switch | **partial** — setting + factory; default nano |
| A2 control form journey | **pass** (scripted) — approve 0→1 submit, receipt |
| A3 control media element API | **pass** unit (control_media digest); Page.controlMedia already exists |
| A4 no Planner write-completed bypass | **hold** — TaskManager still owns completed |
| A5 design current + run_state M2 complete | **no** — LLM control pending |
| A6 G1/G2 regression | M1 matrix still authority; not re-run this slice |

## Not done (next M2 slice)

1. LLM control policy under BrowserContext (MiniMax-M3, JSON harden) so production can set `agentCoreBackend: control` without scripts.
2. Wire factory production path for control without test-only steps.
3. Flip default only after A2/A3 with real model on fixture.
4. Then mark design/002 `current`, G6 claimable, advance run_state.

## Commands

```bash
cd projects/nanobrowser
pnpm -F chrome-extension exec vitest run \
  src/background/agent/backends/__tests__/ \
  src/background/task/__tests__/control-backend-journey.test.ts
```
