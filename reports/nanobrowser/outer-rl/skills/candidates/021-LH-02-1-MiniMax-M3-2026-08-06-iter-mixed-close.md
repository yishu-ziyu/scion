# Skill candidate: 021-LH-02-1-MiniMax-M3-2026-08-06-iter-mixed-close

- task_id: 021-LH-02
- attempt: 1
- model: MiniMax-M3
- prompt_version: chijie-control-v0.3.0
- policy_tag: baseline
- reward_R: 10
- outcome: verified_pass
- source_csv: `reports/nanobrowser/eval/2026-08-06-iter-mixed-close-eval-matrix.csv`
- date: 2026-08-06-iter-mixed-close

## Verified evidence

- false_complete: 0
- wrong_tab: 0
- unapproved_commit: 0
- latency_ms: 10184
- failure_class: 
- notes: url=https://en.wikipedia.org/wiki/Web_browser

## Skill rule (semantic, no coordinates or raw values)

Multi-phase: leave example.com, open en.wikipedia.org/wiki/Web_browser, confirm page text before completing.
