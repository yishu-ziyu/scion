# 022 Adaptive Browser Harness — Release Gate Evidence

**Date:** 2026-08-11  
**Campaign goal:** Answer with reproducible evidence whether commit `139a0a2` (default Adaptive Browser Harness) made Scion stronger without harming reliability.  
**No new product features.** Measure first; no gate green-washing.

## Identity

| Item | Value |
|------|--------|
| Baseline commit (Phase 0) | `12495556fa99e5ea9578fb552011cea0ed2357fd` |
| Current commit (pre-campaign main) | `9c32b1747a164ed64f60b504205a08e735de77fa` |
| Formal model | MiniMax-M3 |
| Prompt version | `chijie-control-v0.3.0` |
| Attach mode | user_chrome / Chrome for Testing (Playwright chromium) |
| Task set | product/022 Phase 0: 013-A01, 013-A03, 013-B04–B08, 018-O1, 018-R1, 021-LH-01–03 |
| Current default flags | Kernel=ON, SkillRuntime=ON, ArtifactVerification=ON, ObservationDiff=**OFF**, LearnedSkills=OFF |
| Baseline worktree | `/tmp/scion-022-baseline-1249555` (detached 1249555, eval-only, deleted after campaign) |
| Baseline validity | **VALID** (ran full Stage1 set successfully) — not `invalid_baseline` |

## Environment parity notes

| Factor | Baseline 1249555 | Current 9c32b17 | Mark |
|--------|------------------|-----------------|------|
| Model / prompt | MiniMax-M3 / chijie-control-v0.3.0 | same | match |
| Chrome | Chrome for Testing (ms-playwright) | same path family (1234 vs 1228 cache minor) | minor drift |
| 018-O1 media | env `E2E_SKIP_MEDIA=1` applied at runner for current; baseline O1 ran without product skip flag in matrix but completed | current matrix sets skip | **marked**: O1 runner env slightly differs; both verified_pass |
| Harness flags | pre-022 (no Kernel/Skill/Artifact defaults) | Kernel/Skill/Artifact ON, Diff OFF | intentional under test |
| Verifier / success criteria | same matrix goals/VERIFY strings | same | match |

## Stage 1 smoke (12 × 1)

### Baseline (1249555)

| task_id | outcome | false_complete | wrong_tab | latency_ms |
|---------|---------|----------------|-----------|------------|
| 013-A01 | verified_pass | 0 | 0 | 1802 |
| 013-A03 | verified_pass | 0 | 0 | 12608 |
| 013-B04 | verified_pass | 0 | 0 | 4102 |
| 013-B05 | verified_pass | 0 | 0 | 5286 |
| 013-B06 | verified_pass | 0 | 0 | 7702 |
| 013-B07 | verified_pass | 0 | 0 | 6504 |
| 013-B08 | verified_pass | 0 | 0 | 2885 |
| 018-O1 | verified_pass | 0 | 0 | 28264 |
| 018-R1 | verified_pass | 0 | 0 | 0 |
| 021-LH-01 | verified_pass | 0 | 0 | 20252 |
| 021-LH-02 | verified_pass | 0 | 0 | 6514 |
| 021-LH-03 | verified_pass | 0 | 0 | 1689 |

**TSR Stage1 baseline:** 12/12 (100%). CSV: `eval/2026-08-11-022-stage1-baseline-v2-eval-matrix.csv` + `eval/2026-08-11-022-stage1-baseline-fixtures-eval-matrix.csv`.

### Current default Harness (9c32b17)

| task_id | outcome | false_complete | wrong_tab | latency_ms |
|---------|---------|----------------|-----------|------------|
| 013-A01 | verified_pass | 0 | 0 | 1753 |
| 013-A03 | verified_pass | 0 | 0 | 17321 |
| 013-B04 | verified_pass | 0 | 0 | 4092 |
| 013-B05 | verified_pass | 0 | 0 | 5292 |
| 013-B06 | verified_pass | 0 | 0 | 12508 |
| 013-B07 | verified_pass | 0 | 0 | 4093 |
| 013-B08 | verified_pass | 0 | 0 | 4087 |
| 018-O1 | verified_pass | 0 | 0 | 24190 |
| 018-R1 | verified_pass | 0 | 0 | 0 |
| 021-LH-01 | **fail** | 0 | 0 | 0 |
| 021-LH-02 | verified_pass | 0 | 0 | 5300 |
| 021-LH-03 | verified_pass | 0 | 0 | 1682 |

**TSR Stage1 current:** 11/12 (91.7%). Failure class `other` on LH-01 only. No false_complete, wrong_tab, crash, or start failure → Stage 2 allowed.

CSV: `eval/2026-08-11-022-stage1-current-v2-eval-matrix.csv` + fixtures.

## Stage 2 formal repeats (current default, n=3)

**36/36 verified_pass. TSR=100%. false_complete=0. wrong_tab=0.**

| task_id | Pass^3 / n | latency ms (all runs) | p50 | notes |
|---------|------------|------------------------|-----|-------|
| 013-A01 | 3/3 | 1678, 1675, 1684 | 1678 | |
| 013-A03 | 3/3 | 6497, 6533, 6492 | 6497 | |
| 013-B04 | 3/3 | 5297, 5302, 5291 | 5297 | |
| 013-B05 | 3/3 | 4090, 4087, 4088 | 4088 | |
| 013-B06 | 3/3 | 6518, 7735, 7730 | 7730 | |
| 013-B07 | 3/3 | 4090, 4089, 4091 | 4090 | |
| 013-B08 | 3/3 | 4088, 4088, 4086 | 4088 | |
| 018-O1 | 3/3 | 20885, 20772, 20658 | 20772 | |
| 018-R1 | 3/3 | 0, 0, 0 | 0 | rows=6 each |
| 021-LH-01 | 3/3 | 12517, 59454, 11320 | 12517 | Stage1 fail was variance |
| 021-LH-02 | 3/3 | 6511, 5299, 5311 | 5311 | |
| 021-LH-03 | 3/3 | 1684, 1684, 1681 | 1684 | |

CSV: `eval/2026-08-11-022-stage2-current-eval-matrix.csv`.

### Baseline vs current (Stage1 head-to-head + Stage2 current)

| task_id | Baseline S1 | Current S1 | Current S2 TSR (n=3) |
|---------|-------------|------------|----------------------|
| 013-A01 | pass | pass | 3/3 |
| 013-A03 | pass | pass | 3/3 |
| 013-B04 | pass | pass | 3/3 |
| 013-B05 | pass | pass | 3/3 |
| 013-B06 | pass | pass | 3/3 |
| 013-B07 | pass | pass | 3/3 |
| 013-B08 | pass | pass | 3/3 |
| 018-O1 | pass | pass | 3/3 |
| 018-R1 | pass | pass | 3/3 |
| 021-LH-01 | pass | fail | **3/3** |
| 021-LH-02 | pass | pass | 3/3 |
| 021-LH-03 | pass | pass | 3/3 |

**Conclusion (reliability):** Default Harness does **not** show a sustained TSR regression vs Phase 0 baseline. Stage1 LH-01 single fail is high-variance; Stage2 recovers to 3/3.

**Conclusion (strength):** Formal public+fixture+LH set remains at ceiling under MiniMax-M3; no measured uplift in TSR (already ~100%). Strength evidence is mechanism gates (Kernel path, Skill fallback, Verifier, Artifact, Trace), not higher TSR.

## Observation Diff controlled experiment

Same commit `9c32b17`, model MiniMax-M3, tasks: 021-LH-01/02/03 + 013-B04 + 013-B05, n=3 each.

| Arm | flag | TSR | false_complete | wrong_tab |
|-----|------|-----|----------------|-----------|
| Diff OFF | enableObservationDiff=false | 15/15 | 0 | 0 |
| Diff ON | enableObservationDiff=true | 15/15 | 0 | 0 |

CSV: `eval/2026-08-11-022-diff-off-eval-matrix.csv`, `eval/2026-08-11-022-diff-on-eval-matrix.csv`.

### Payload reduction (live traces)

- Diff OFF: kernel.observe `rendered_chars == full_chars` always; median reduction **0%**.
- Diff ON: `observation.diff` spans present (n=7 across dumps); **mode always `full`** on formal multi-hop (URL change → forceFull); median reduction on observed steps **0%**.
- Unit synthetic multi-step same-URL (`022-DIFF-01`): median reduction **≥30%** (PASS unit contract).

**Gate requirement:** median observation payload reduction ≥30% **and** no meaningful TSR drop.

| Sub-check | Result |
|-----------|--------|
| TSR no meaningful drop | PASS (15/15 both arms) |
| Live median reduction ≥30% | **FAIL (0%)** |
| Production default | remains `enableObservationDiff=false` (correct under FAIL) |

### Failure → hypothesis → smallest fix (not applied this campaign)

1. **Observed:** Diff ON does not reduce live formal-task observation payload; spans show `mode=full`.
2. **Hypothesis:** `reobserve` sets `forceFull` whenever URL changes; Phase 0 formal multi-hop tasks mostly navigate, so Diff never enters `mode=diff`. Same-page multi-reobserve is rare in this set.
3. **Smallest falsifiable fix (future):** instrument same-URL multi-step fixture (scroll/filter on one page) and/or count only same-URL reobserve steps without changing the ≥30% threshold definition. Do **not** retune statistics to force PASS.
4. **Default:** keep Diff OFF until live ≥30% is proven on a fair multi-step same-page sample.

## 022 dedicated harness tasks (020 registry)

Registered in `docs/product/020-eval-master.md` and `TASK_SET=harness_022` / unit runner.

| task_id | outcome | evidence |
|---------|---------|----------|
| 022-KERNEL-01 | verified_pass | unit Kernel ON/OFF parity |
| 022-DIFF-01 | verified_pass (unit ≥30%); live payload FAIL as above | unit + live Diff e2e |
| 022-SKILL-01 | verified_pass | products list extract e2e |
| 022-SKILL-02 | verified_pass | skill fail → fallback, no death |
| 022-VERIFY-01 | verified_pass | wrong candidate_complete rejected |
| 022-ARTIFACT-01 | verified_pass | schema / row / source real checks |
| 022-LEARN-01 | **invalid_run / BLOCKED** | enableLearnedSkills=false; not a FAIL |

## Side effects / Trace / Privacy

### Side effects

- Static boundary tests walk all skill sources; forbid `chrome.tabs`, `chrome.debugger`, `BrowserContext` direct use.
- Runtime traces show `kernel.act_*` after `skill.run` / LLM decide — not direct chrome APIs from skills.
- Evidence: `side-effects-boundary.test.ts` + real traces under `traces/`.

### Trace (real dumps, not type-only)

Example: `traces/013-A01-*.json`

| Required span | Present | Key fields |
|---------------|---------|------------|
| kernel.observe | yes | frame_id, full_chars, rendered_chars |
| skill.discover | yes | step |
| skill.run | yes | skill_id, skill_version, candidate_count, selected_reason, duration, outcome, fallback_used |
| kernel.act_* | yes (multi-step tasks) | act names |
| observation.diff | yes on Diff ON runs | mode, observation_full_chars, observation_rendered_chars, diff_chars |
| artifact.create | yes | artifact_id, artifact_type |
| verify.artifacts | yes | criteria, passed, failed, inconclusive, evidence_ref, verdict |

### Privacy

- Unit: fake cookie/password/api key/form/private prompt → redacted snapshot and artifact paths must not retain secrets.
- Live trace scan over Stage2 dumps: **0** hits for secret-like full form values / password fields / sk- keys in persisted span data; only aggregate lengths and redacted metadata.
- Evidence: `022-privacy-gate.test.ts` + scan of `traces/*.json`.

## Release Gate matrix (status ∈ PASS | FAIL | BLOCKED | INVALID only)

| Gate | Status | Evidence | Metric | Failure / remaining gap |
|------|--------|----------|--------|-------------------------|
| Regression | **PASS** | Stage1 baseline 12/12; Stage2 current 36/36; S1 current 11/12 variance only on LH-01 | TSR current S2 = 100% vs baseline S1 100% | None sustained |
| False Complete | **PASS** | All Stage1/2/Diff CSVs | false_complete sum = 0 | None |
| Wrong Tab | **PASS** | All Stage1/2/Diff CSVs | wrong_tab sum = 0 | None |
| Core purity | **PASS** | `control-llm-core-purity.test.ts` unit | unit verified_pass | None |
| Side effects | **PASS** | static skill audit + runtime kernel.act traces | 0 forbidden imports; acts via Kernel | Runtime import audit is static-dominant; path evidence from traces |
| Observation Diff ≥30% | **FAIL** | live Diff ON traces median reduction 0%; unit synthetic ≥30% | live median 0% < 30%; TSR OK | Keep Diff default=false; same-URL multi-step live sample still needed |
| Skill fallback | **PASS** | 022-SKILL-02 unit | fail skill → handled=false, fallback_used, no throw | None |
| Verification | **PASS** | 022-VERIFY-01 + 022-ARTIFACT-01 unit | wrong candidate rejected; schema/row/source | None |
| Trace | **PASS** | real TRACE_DUMP JSON from Stage2 / Diff ON | spans + required skill/verify fields present | Diff span only when Diff ON (expected) |
| Privacy | **PASS** | unit + live trace scan | no secrets in persisted traces/artifacts | Live scan is pattern-based, not full chrome.storage dump of all keys |

## release_status

```text
release_status: not_eligible_for_owner_promotion
```

Reason: **Observation Diff ≥30% Gate = FAIL** (live). Other reliability gates PASS. Do **not** auto-promote 022 product_status. Owner may still accept reliability package while leaving Diff OFF.

If Owner only cares about default-on Kernel/Skill/Artifact reliability: evidence supports no TSR harm; promotion remains Owner decision.

## Artifact index

| Path | Role |
|------|------|
| `reports/nanobrowser/022-release/2026-08-11-release-gate.md` | this file |
| `reports/nanobrowser/022-release/eval/*-stage1-*` | Stage1 CSVs |
| `reports/nanobrowser/022-release/eval/*-stage2-current*` | Stage2 n=3 |
| `reports/nanobrowser/022-release/eval/*-diff-off*` / `*-diff-on*` | Diff experiment |
| `reports/nanobrowser/022-release/traces/` | Stage2 TRACE_DUMP |
| `reports/nanobrowser/022-release/traces-diff-on/` | Diff ON traces (observation.diff) |
| `reports/nanobrowser/022-release/unit-gates-v2.log` | unit matrix rows |

## Decision discipline note

No architecture rewrite after Diff FAIL. Hypothesis recorded; default stays OFF. Sunk cost of Diff implementation does not force production ON.
