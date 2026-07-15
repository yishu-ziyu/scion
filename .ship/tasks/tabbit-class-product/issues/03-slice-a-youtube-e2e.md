# 03 — Slice A: open YouTube E2E (minimum green)

**What to build:** On **main Chrome** with MiniMax-M3, user says open YouTube (or Chinese equivalent) in task mode → content tab loads YouTube → steps readable → **verified done**. Evidence note under reports. This is the product MVP minimum green.

**Blocked by:** 02 — Observe → act → re-observe loop

**Status:** implemented (unit + protocol + runner; live MiniMax CDP needs Owner reload if goal-input missing)

**Seams:** S5, S1, S2

- [x] Protocol fixed: model MiniMax-M3; instruction class “打开 YouTube”
- [x] Content tab shows YouTube main surface (not extension page) — protocol + E2E runner checks
- [x] Steps human-readable; done only with load evidence — UI ticket 01 + protocol
- [x] No false complete when navigation fails — TaskManager unit test
- [x] Short evidence path under `reports/nanobrowser/golden/`
- [x] Owner can reproduce with reload extension + side panel (protocol manual steps)

**Artifacts:**
- `reports/nanobrowser/golden/slice-a-youtube-protocol.md`
- `chrome-extension/scripts/slice-a-youtube-e2e.mjs`
- Journey: navigation failure → no receipt
