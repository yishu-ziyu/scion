# Tabbit alignment statement (G8)

Status: **draft template** — not a claim of parity.

## Comparison frame

| Axis | Meituan Tabbit (public) | Scion / Nanobrowser (ours) |
|------|-------------------------|----------------------------|
| Agent task success | ~91.8% (their definition) | verified_pass / attempts on **frozen** golden set |
| Web-ops bench | ≥70% | long-tail pool verified ≥70% if expanded |
| Model for official score | (their stack) | **MiniMax-M3** mid-tier only |
| Completion | (not fully public) | page evidence required; model `done` insufficient |
| External commit | (product UX) | one-use approval; 0 unapproved |

Sources for their numbers: public media / official intros (not our re-measurement of their bench). See `docs/product/003-north-star.md`.

## Our denominator (fill when M3/M5 done)

| Gate | n | model | verified_pass | rate | evidence path |
|------|---|-------|---------------|------|---------------|
| G1 form fixture | 10 | MiniMax-M3 | 10 | 100% | `reports/nanobrowser/bakeoff/2026-07-14-m1-matrix.csv` |
| G2 media fixture | 10 | MiniMax-M3 | 10 | 100% | same |
| G3 Feishu | — | — | — | — | blocked on Owner login |
| G4 Bilibili | — | — | — | — | blocked on Owner login |

## Failure taxonomy (when real-site runs exist)

| Code | Meaning |
|------|---------|
| login_wall | captcha / force login |
| selector_miss | target not found |
| approval_timeout | user did not approve |
| false_complete | claimed done without evidence |
| unapproved_commit | external commit without token |
| model_loop | max steps / thrash |
| other | free text in notes |

## Explicit non-claims

- We do **not** claim to reproduce Meituan’s internal benchmark task mix.
- We do **not** claim product feature parity with Tabbit browser.
- Fixture 100% is **not** the same as Agent 91.8% on real multi-site workflows.

## Sign-off

| Role | Date | Note |
|------|------|------|
| Agent (draft) | 2026-07-15 | Template only |
| Owner | | Required before any public “aligned with Tabbit” wording |
