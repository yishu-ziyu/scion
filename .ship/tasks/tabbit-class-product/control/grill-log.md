# grill-with-docs log — tabbit-class-product

## Q1 — MVP acceptance loop

- **Asked:** Is the Tabbit-style chain the sole primary MVP acceptance?
- **Owner:** A (yes)
- **Captured:** `CONTEXT.md` → Agent task loop (MVP acceptance)
- **Time:** 2026-07-15

## Q2 — Carrier (shell)

- **Asked:** Extension vs full browser vs engine-first CDP?
- **Owner:** A — Chrome extension on daily Chrome + task-mode side panel
- **Effect:** Confirms ADR 001 (keep extension). Full browser (Tabbit-class app) deferred.
- **Captured:** `CONTEXT.md` → Shell vs core
- **Time:** 2026-07-15

## Q3 — Execution core

- **Owner signal:** Affirmed the two-layer split (agent loop in TS; browser control via extension APIs / debugger), not wholesale browser-use Python in the plugin.
- **Decision:** **A+architecture** — strengthen in-extension core; reimplement browser-use-style agent loop in TS; control via chrome.* / debugger; no Python side process as MVP default.
- **Captured:** `CONTEXT.md` → Shell vs core
- **Time:** 2026-07-15

## Q4 — Approval policy

- **Owner:** C — approve only when action is external commit; read/nav free
- **Captured:** `CONTEXT.md` → Approval policy (MVP)
- **Time:** 2026-07-15

## Q5 — First vertical slice order

- **Owner:** D — Slice A (open YouTube) first minimum green; B (Feishu+approval) and C (Bilibili pause) follow on the same core
- **Captured:** `CONTEXT.md` → Delivery order (MVP slices)
- **Time:** 2026-07-15

## Q6 — Scope this cycle

- **Owner:** A — task mode + steps + completion + extension + MiniMax
- **Out:** skill marketplace, full browser, pet, smart tab groups, multi-model shelf UI
- **Later intent (note only):** cross-conversation memory — Owner wants it eventually; not this cycle
- **Captured:** `CONTEXT.md` → In/Out scope + Later intent
- **Time:** 2026-07-15

## Open

- Confirm shared understanding with Owner → then `/to-spec`
