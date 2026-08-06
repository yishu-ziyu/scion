# Outer loop skill candidates

- Generated: 2026-08-06T15:53:56.869Z
- TASK_SET: long_horizon
- MIN_R: 9
- Sources (12):
  - `reports/nanobrowser/eval/2026-08-06-iter-formal-batch-eval-matrix.csv` (10 rows)
  - `reports/nanobrowser/eval/2026-08-06-iter-lh-final-eval-matrix.csv` (3 rows)
  - `reports/nanobrowser/eval/2026-08-06-iter-lh-grok-final-eval-matrix.csv` (2 rows)
  - `reports/nanobrowser/eval/2026-08-06-iter-lh-minimax-eval-matrix.csv` (3 rows)
  - `reports/nanobrowser/eval/2026-08-06-iter-lh-minimax-r2-eval-matrix.csv` (3 rows)
  - `reports/nanobrowser/eval/2026-08-06-iter-lh-r4-eval-matrix.csv` (2 rows)
  - `reports/nanobrowser/eval/2026-08-06-iter-lh01-grok-eval-matrix.csv` (1 rows)
  - `reports/nanobrowser/eval/2026-08-06-iter-lh01-r5-eval-matrix.csv` (1 rows)
  - `reports/nanobrowser/eval/2026-08-06-iter-lh02-grok-eval-matrix.csv` (1 rows)
  - `reports/nanobrowser/eval/2026-08-06-iter-lh02-r3-eval-matrix.csv` (1 rows)
  - `reports/nanobrowser/eval/2026-08-06-iter-mixed-close-eval-matrix.csv` (4 rows)
  - `reports/nanobrowser/eval/2026-08-06-iter-smoke-final-eval-matrix.csv` (2 rows)
- Rows after task filter: 22
- Qualified candidates (R>=9, verified_pass, no false_complete/wrong_tab/unapproved_commit): 16

- 021-LH-01-1-MiniMax-M3-2026-08-06-iter-formal-batch R=10
- 021-LH-02-1-MiniMax-M3-2026-08-06-iter-formal-batch R=10
- 021-LH-03-1-MiniMax-M3-2026-08-06-iter-formal-batch R=10
- 021-LH-01-1-MiniMax-M3-2026-08-06-iter-lh-final R=10
- 021-LH-02-1-MiniMax-M3-2026-08-06-iter-lh-final R=10
- 021-LH-03-1-MiniMax-M3-2026-08-06-iter-lh-final R=10
- 021-LH-01-1-grok-4.5-2026-08-06-iter-lh-grok-final R=10
- 021-LH-02-1-grok-4.5-2026-08-06-iter-lh-grok-final R=10
- 021-LH-03-1-MiniMax-M3-2026-08-06-iter-lh-minimax R=10
- 021-LH-01-1-MiniMax-M3-2026-08-06-iter-lh-minimax-r2 R=10
- 021-LH-03-1-MiniMax-M3-2026-08-06-iter-lh-minimax-r2 R=10
- 021-LH-02-1-MiniMax-M3-2026-08-06-iter-lh-r4 R=10
- 021-LH-01-1-MiniMax-M3-2026-08-06-iter-lh01-r5 R=10
- 021-LH-02-1-grok-4.5-2026-08-06-iter-lh02-grok R=10
- 021-LH-02-1-MiniMax-M3-2026-08-06-iter-mixed-close R=10
- 021-LH-03-1-MiniMax-M3-2026-08-06-iter-smoke-final R=10

## Eligibility note

Only real matrix rows with `outcome=verified_pass` and reward R>=9 produce cards.
Failed / false_complete / login_wall rows are never invented as success trajectories.
