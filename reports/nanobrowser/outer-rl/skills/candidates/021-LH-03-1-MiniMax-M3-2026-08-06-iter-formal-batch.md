# Skill candidate: 021-LH-03-1-MiniMax-M3-2026-08-06-iter-formal-batch

- task_id: 021-LH-03
- attempt: 1
- model: MiniMax-M3
- prompt_version: chijie-control-v0.3.0
- policy_tag: baseline
- reward_R: 10
- outcome: verified_pass
- source_csv: `reports/nanobrowser/eval/2026-08-06-iter-formal-batch-eval-matrix.csv`
- date: 2026-08-06-iter-formal-batch

## Verified evidence

- false_complete: 0
- wrong_tab: 0
- unapproved_commit: 0
- latency_ms: 1782
- failure_class: 
- notes: url=http://127.0.0.1:61186/products

## Skill rule (semantic, no coordinates or raw values)

Multi-phase on products fixture: extract name,price,rating table (≥5 rows), then report the most expensive item (Beta Mechanical Keyboard).
