# Frontier Eval v1 — Comparison (FROZEN / ABORTED)

**Status:** Owner stopped long black-box formal run. **No more Frontier samples, recalibration, or v2/v3.**  
**Date:** 2026-08-11  
**Model:** MiniMax-M3 · Prompt: `chijie-control-v0.3.0`  
**Baseline product:** `1249555` dist · **Current product:** `8cdebd8` (pre-this-campaign tip may differ on tree)

## Completeness (honest)

| Arm | Planned | Captured | Complete? |
|-----|---------|----------|-----------|
| Phase0 baseline n=3 (12 tasks) | 36 | **36** | **YES** |
| Phase0 current n=3 (from prior Stage2) | 36 | **36** | **YES** |
| Frontier current n=3 (F1–F8) | 24 | **24** | **YES** (log has CURRENT_EXIT) |
| Frontier baseline n=3 (F1–F8) | 24 | **19** (through F7×1) | **NO — killed mid-batch** |

Baseline Frontier missing: F7×2, F8×3 (and any remaining). Do **not** treat Frontier baseline TSR as full n=3.

---

## A / B — Phase0 Regression (rigorous n=3)

| | Baseline 1249555 | Current |
|--|------------------|---------|
| TSR | **36/36 = 100%** | **36/36 = 100%** |
| false_complete | 0 | 0 |
| wrong_tab | 0 | 0 |

**ceiling confirmed.** Phase0 cannot show Adaptive Harness “stronger”; only “not worse” on this set.

CSV: `phase0-baseline-n3-eval-matrix.csv`, `phase0-current-n3-eval-matrix.csv`.

---

## A / B — Frontier formal (partial)

### B. Current success

- **TSR = 3/24 = 12.5%**
- false_complete = 1 · wrong_tab = 0

| task | Pass^k / 3 | note |
|------|------------|------|
| F1 extract catalog capsules | **2/3** | only reliable win |
| F2 multi-stage filter/expand | 0/3 | timeout / step fail |
| F3 interrupt resume | 0/3 | login_wall misclass / fail |
| F4 wrong-tab recovery | 0/3 | timeout |
| F5 leave trap | 0/3 | timeout / stuck on trap |
| F6 expand + source_id | 0/3 | login_wall misclass / fail |
| F7 no-progress recovery | **1/3** | rare recovery |
| F8 same-page SPA | 0/3 | step exhaust |

CSV: `frontier-current-n3-eval-matrix.csv`.

### A. Baseline success (incomplete)

- **TSR = 0/19 = 0%** on captured rows only  
- false_complete = **6** (verify_fail after completed-without-evidence)  
- wrong_tab = 0  
- No F1–F6 passes; F7 0/1; F8 not run

CSV: `frontier-baseline-n3-eval-matrix.csv` (truncated).

### C. delta (only what data allows)

| Metric | Baseline (partial) | Current (full 24) | Delta |
|--------|--------------------|-------------------|-------|
| TSR | 0% (19 rows) | 12.5% (24 rows) | **+12.5 pp** on unequal, incomplete baseline |
| false_complete | 6/19 | 1/24 | current lower on partial data |
| F1 Pass^3 | 0/3 | 2/3 | current better |
| F2–F6,F8 | 0 | 0 | no gain |
| F7 | 0/1 | 1/3 | weak / incomplete |

**Not a clean A/B.** Do not claim product “much stronger” from incomplete baseline + floor-level TSR.

### D. Tasks with real lift (on available data)

- **F1 only** (table extract of three capsules + prices): current 2/3 vs baseline 0/3.  
- Possibly fewer **false_complete** on baseline’s F3–F5 verify_fail cluster vs current (current still mostly fails before verify).

### E. No lift

- F2 multi-stage filter/sort/expand  
- F3 interrupt  
- F4 wrong tab  
- F5 trap leave  
- F6 source expand  
- F8 same-page SPA  

### F. Regression

- No Phase0 regression.  
- Frontier: no clear current **worse** than baseline where both finished; baseline had **more false_complete** on partial sample (not a free pass for current).

### G. Mechanism (plain)

1. Old Phase0 tasks are **too easy** → both 100%.  
2. Frontier fixtures need select/filter/expand/leave-trap; MiniMax-M3 + control loop **mostly dies** (timeout, step fail, waiting_user mislabeled login_wall).  
3. Adaptive Harness default flags **did not** turn hard multi-step local SPA into reliable wins in this sample.  
4. Long matrix runs are **opaque** (single log tail, hours of Chrome) — process cost is a product/ops problem of its own.

### H. Efficiency

Not computed: almost all frontier runs **failed**, so success-conditioned latency/actions are not meaningful. Traces under `traces-current-n3/` exist for partial forensics only.

### I. Largest remaining product bottleneck

**Not “need more Kernel.”** From failures:

1. **Multi-step UI control** on non-public fixtures (select / Apply / Expand / leave trap) — agent cannot reliably operate.  
2. **Interrupt / wrong-tab / recovery** (F3/F4/F7) — still near zero.  
3. **False complete** still appears under baseline on incomplete deliverables (6×).  
4. Eval process **black box** (long sequential Chrome) — Owner cannot supervise.

---

## Final judgment (only three labels)

```text
NO_MEASURED_GAIN
```

Reasons:

1. Phase0: **ceiling both sides** — no strength signal.  
2. Frontier: current **12.5%** is not “strong”; baseline incomplete **0%** cannot prove a clean win.  
3. Hard families (interrupt, wrong tab, trap, SPA, multi-stage filter) remain **near zero** on current.

**Not STRONGER** (no reliable multi-task lift). **Not REGRESSED** on Phase0 (100% = 100%).

---

## Freeze

- Frontier Eval **frozen**. No v2/v3, no recalibration, no more formal n.  
- Observation Diff still **OFF** (unchanged).  
- Next work: **real self-use Scion**, not eval infrastructure.

## Files

- `frontier-task-registry.md`  
- `frontier-current-n3-eval-matrix.csv`  
- `frontier-baseline-n3-eval-matrix.csv` (truncated)  
- `phase0-*-n3-eval-matrix.csv`  
- fixtures + runner under `projects/chijie-browser` (eval-only; no product feature ship claim)
