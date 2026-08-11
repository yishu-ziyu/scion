# Frontier Eval v1 — Task Registry

**Purpose:** Discriminating long-horizon eval (headroom). Not Phase 0 ceiling regressor.  
**Scoring:** User outcomes only — not Kernel/Skill call counts.  
**Product under test:** `EXTENSION_PATH` → built `dist/` (baseline `1249555` or current).  
**Model:** MiniMax-M3 · Prompt: `chijie-control-v0.3.0`  
**Runner:** `chrome-extension/scripts/eval-frontier-task.mjs`  
**Task set:** `TASK_SET=frontier_v1`  
**Fixtures:** `chrome-extension/test/fixtures/frontier/`  
**Diff:** frozen OFF; F8 may record natural same-page metrics only.

## Calibration note

Smoke v1 (multi-source 3× datasheets + strict research verifier) hit **floor (~0/8)** — timeouts / false_complete on trap. Goals were simplified to catalog/SPA multi-step paths while keeping:

- multi-stage navigation
- trap rejection
- interrupt (target reload)
- wrong-tab stress
- no-progress recovery
- same-page filter/expand
- source fields (F6)

Hardness target for baseline formal: **40–80% TSR**. Re-calibrate again only if formal baseline ≥90% or ≈0%.

## Families (v1 calibrated)

| ID | Family | Start | VERIFY / EXPECTED core | Stress |
|----|--------|-------|------------------------|--------|
| F1 | LONG_RESEARCH | hub → catalog capsule | 3 names + real prices | — |
| F2 | MULTI_STAGE_DELIVERY | hub → catalog module+expand | Beta Dock Module + Z-MOD-0042 + 510000 | — |
| F3 | INTERRUPT_RESUME | hub → catalog capsule | same as F1 | target page reload @10s |
| F4 | WRONG_TAB_RECOVERY | hub → catalog capsule | same as F1 | open example.com @8s |
| F5 | SKILL_BREAK / trap leave | **trap** → catalog | real prices; not 999/888 | poisoned start |
| F6 | ARTIFACT_ADVERSARIAL | hub → catalog + expand×3 | prices + SRC-ORION/NOVA/VEGA | source required |
| F7 | NO_PROGRESS_RECOVERY | delay.html | RT-77-OK / Hidden Report 77 | simple search fails once |
| F8 | SAME_PAGE_COMPLEX | spa.html | Z-MOD-0042 | same URL filter/expand |

## Ground truth

| name | price_usd | source_id (expand) |
|------|-----------|---------------------|
| Orion Capsule | 2100000 | SRC-ORION-01 |
| Nova Capsule | 1800000 | SRC-NOVA-02 |
| Vega Capsule | 2900000 | SRC-VEGA-03 |
| Beta Dock Module | 510000 | serial Z-MOD-0042 |
| Hidden Report 77 | — | recovery_token=RT-77-OK |

Trap prices 999/888 must not satisfy research-style tasks.

## Commands

```bash
cd projects/chijie-browser

# Current
REPORT_DIR=../../reports/nanobrowser/frontier-eval-v1 \
  TASK_SET=frontier_v1 RUNS=3 MODEL=MiniMax-M3 \
  POLICY_TAG=frontier_current_n3 MATRIX_STAMP=frontier-current-n3 \
  pnpm eval:matrix

# Baseline dist under same runner
EXTENSION_PATH=/tmp/scion-frontier-baseline-1249555/projects/chijie-browser/dist \
  REPORT_DIR=../../reports/nanobrowser/frontier-eval-v1 \
  TASK_SET=frontier_v1 RUNS=3 MODEL=MiniMax-M3 \
  POLICY_TAG=frontier_baseline_n3 MATRIX_STAMP=frontier-baseline-n3 \
  pnpm eval:matrix
```
