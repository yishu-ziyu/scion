# 03 — Slice A: open YouTube E2E (minimum green)

**What to build:** On **main Chrome** with MiniMax-M3, user says open YouTube (or Chinese equivalent) in task mode → content tab loads YouTube → steps readable → **verified done**. Evidence note under reports. This is the product MVP minimum green.

**Blocked by:** 02 — Observe → act → re-observe loop

**Status:** ready-for-agent

**Seams:** S5, S1, S2

- [ ] Protocol fixed: model MiniMax-M3; instruction class “open YouTube”
- [ ] Content tab shows YouTube main surface (not extension page)
- [ ] Steps human-readable; done only with load evidence
- [ ] No false complete when navigation fails
- [ ] Short evidence report under `reports/nanobrowser/`
- [ ] Owner can reproduce with reload extension + side panel
