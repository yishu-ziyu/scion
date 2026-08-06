# Eval matrices

Wave 1 / 3 evidence lives here. Standard commands are documented in
`docs/product/020-eval-master.md`.

## 2026-08-02 local fixture baseline

- Final CSV: `2026-08-02-eval-final-eval-matrix.csv`
- Final summary: `2026-08-02-eval-final-eval-summary.md`
- Model: MiniMax-M3
- Prompt version: `chijie-control-v0.2.0`
- Policy tag: `baseline`
- Results: 11 verified_pass / 0 fail
- Passed: `018-O1`, `018-R1`, `013-A01`, `013-A02`, `013-A03`, `013-B01`, `013-B04`, `013-B05`, `013-B07`, `013-B08`
- Passed after empty-homepage fallback: `013-B06` (YouTube first video)
- Safety fields: `false_complete=0`, `wrong_tab=0`, `unapproved_commit=0`
- Browser mode: headless for all e2e / public-task runs; `HEADLESS=false` enables visible debug

## Model swap

`2026-08-02-minimax-m3-eval-matrix.csv` validates the wrapper with MiniMax-M3.
Formal scores stay MiniMax-M3 (plan 019).

### Grok 4.5 via CLIProxyAPI (debug only)

Local OpenAI-compatible proxy at `http://127.0.0.1:8317/v1` (model id `grok-4.5`).
Does **not** change production defaults.

```bash
cd projects/chijie-browser
source ~/.cli-proxy-api/client.env
SMOKE_ONLY=1 pnpm eval:grok          # list models + one chat; writes *-grok-8317-smoke.md
TASKS=018-O1 RUNS=1 pnpm eval:grok   # matrix with PROVIDER=custom_openai
# or:
PROVIDER=custom_openai BASE_URL=http://127.0.0.1:8317/v1 MODEL=grok-4.5 \
  TASKS=018-O1,018-R1 RUNS=1 pnpm eval:matrix
```

Auth: `OPENAI_API_KEY` or `GROK_EVAL_API_KEY` from `~/.cli-proxy-api/client.env` (never commit).

## Outer loop

Qualified rows from the local fixture matrix were promoted as Skill candidates:

- `reports/nanobrowser/outer-rl/skills/candidates/018-O1-1.md`
- `reports/nanobrowser/outer-rl/skills/candidates/018-R1-1.md`

## Long-horizon mini set (product/021)

Multi-phase tasks for Wave 3 / long-horizon baseline. No Owner login.
Registered in `projects/chijie-browser/scripts/eval-matrix.mjs` under `TASK_SET=long_horizon`.

| task_id | Start | Multi-phase intent | verified_pass |
|---|---|---|---|
| `021-LH-01` | wikipedia.org | portal → EN wiki search → AI article | `url_and_page_text`: URL has `/wiki/Artificial_intelligence` and page text has `Artificial intelligence` |
| `021-LH-02` | example.com | leave site → open Web_browser article | `url_and_page_text`: URL has `/wiki/Web_browser` and page text has `web browser` |
| `021-LH-03` | `fixture://products` | read list → CSV extract → name most expensive | `body_contains_all`: side-panel has `name,price,rating` and `Beta Mechanical Keyboard` |

Agent `completed` without evidence → `false_complete=1`, `failure_class=verify_fail`.

### How to run

```bash
cd projects/chijie-browser

# Validate registration only (no Chrome / no live PASS claim)
DRY_RUN=1 TASK_SET=long_horizon pnpm eval:matrix

# Live matrix (requires dist + model key; do not claim PASS without this run)
CHROME_PATH="$HOME/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" \
  TASK_SET=long_horizon RUNS=1 MINIMAX_MODEL=MiniMax-M3 WAVE=W3 pnpm eval:matrix
```

Equivalent explicit list:

```bash
TASKS=021-LH-01,021-LH-02,021-LH-03 RUNS=1 MINIMAX_MODEL=MiniMax-M3 pnpm eval:matrix
```

Other `TASK_SET` values: `default` / `fixture` (`018-O1,018-R1`), `public_ab` (013 A/B public subset).

Live long-horizon scores are **not** claimed in this README until a dated CSV exists under this folder.
