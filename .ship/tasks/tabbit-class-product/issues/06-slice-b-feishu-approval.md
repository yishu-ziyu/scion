# 06 — Slice B: Feishu form + approval (simplified G3)

**What to build:** On Owner daily Chrome login, agent fills a designated Feishu form/doc field, **stops before submit**, Owner approves, single submit, page success evidence, completion receipt. Same core as Slice A—not a second product.

**Blocked by:** 03 — Slice A YouTube E2E; 05 — External-commit approval gate

**Status:** ready-for-agent

**Seams:** S5, S2

- [ ] Owner provides writable Feishu URL; MiniMax-M3 formal run
- [ ] Zero submit before approval; one submit after
- [ ] Verified completion from page evidence only
- [ ] Matrix row + notes under `reports/nanobrowser/golden/` (or agreed path)
- [ ] Failure classified if blocked (login_wall etc.)
