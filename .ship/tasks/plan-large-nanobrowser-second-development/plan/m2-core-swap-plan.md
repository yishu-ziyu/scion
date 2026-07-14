# M2 Plan — Production core swap

**Authority:** `docs/product/003`, `docs/design/002`, `docs/product/004`  
**run_state:** `current_milestone: M2`

## Goal

Make Agent Core replaceable under the existing Task/approval/receipt shell (G6).  
Default production path can run a P1-parity **control** backend; **nano** remains demotable.

## Stories

| ID | Story | Acceptance |
|---|---|---|
| M2-S1 | Docs: design/002 + index + design/001 status | Docs readable; README points to M2 |
| M2-S2 | Factory multi-backend (`nano` \| `control`) | Setting selects driver; tests pass |
| M2-S3 | Extract nano backend | Behavior parity with previous default |
| M2-S4 | Control-loop driver skeleton | Scripted fixture form/media via hooks + TaskManager |
| M2-S5 | Media element API path explicit | control_media uses Page.controlMedia; no shadow-click success |
| M2-S6 | Evidence + run_state | reports/nanobrowser/m2-*; G6 claim when A1–A6 green |

## Non-goals

- Feishu/Bilibili 91.8% (M3)
- Delete Nano source
- Embed Node Stagehand in MV3

## Order

S1 → S2+S3 → S4 → S5 → S6

## Done when

`design/002` Acceptance A1–A6 satisfied.
