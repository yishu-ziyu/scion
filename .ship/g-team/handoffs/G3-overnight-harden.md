HANDOFF|task=g3-harden|status=delivered|files=projects/chijie-browser/chrome-extension/src/background/agent/backends/control-llm.ts,projects/chijie-browser/chrome-extension/src/background/agent/backends/__tests__/control-llm-outcome.test.ts|tests=control-llm-outcome:0;observe-act-loop:0;manager:0;failure-taxonomy:0|unverified=dist not rebuilt (owner Chrome live); no browser E2E

# g3-harden overnight

## Solidify control stop path
- Exported `CONTROL_MAX_NO_PROGRESS = 3` and pass it explicitly into `runObserveActLoop`.
- Exported pure `mapLoopOutcomeToExecutor`:
  - `failed` + `no_progress` | `max_steps` → same category (no collapse)
  - empty category → `unknown`
  - `waiting_user` stays waiting (not failed)
  - `candidate_complete` / `cancelled` mapped explicitly
- Unit tests: `control-llm-outcome.test.ts` (7)

## Test commands (cwd: projects/chijie-browser) — all exit 0
```bash
pnpm -F chrome-extension test -- src/background/agent/backends/__tests__/control-llm-outcome.test.ts   # 7 pass
pnpm -F chrome-extension test -- src/background/agent/backends/__tests__/observe-act-loop.test.ts     # 10 pass
pnpm -F chrome-extension test -- src/background/task/__tests__/manager.test.ts                       # 35 pass
pnpm -F @extension/sidepanel test -- src/presentation/__tests__/failure-taxonomy.test.ts             # 5 pass
```

Totals: 57 unit tests green.

## dist / Chrome (documented only — NOT run)
- Load-unpacked extension uses `projects/chijie-browser/dist/`.
- Overnight harden did **not** run `pnpm build` / `pnpm dev` (would touch dist; owner may have Chrome with extension loaded).
- Owner wake path for code-in-browser:
  1. Save work / optional close side panel
  2. `pnpm build` (or `pnpm dev` watch) from `projects/chijie-browser`
  3. Chrome → Extensions → reload chijie card
  4. Reopen side panel; run complex task to see failed + model_loop label on no_progress/max_steps
- Do **not** kill owner Chrome processes from agents.

## Not done
- G4 independent reverify of 011
- Real side-panel screenshot
- Feishu 06
