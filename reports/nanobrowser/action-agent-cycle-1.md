# Action Agent Cycle 1 — acceptance evidence

- Date: 2026-07-14
- Product: Nanobrowser 二开 (scion lab)
- PRD: `docs/product/001-nanobrowser-prd.md`
- Design: `docs/design/001-browser-action-task-runtime.md` (status remains `not-implemented` until 10/10 automated + owner journeys pass)
- Build base: pre-Story-7 product commits through human-timeline; Story 7 hardening in flight

## Automated gate

| Check | Result | Notes |
|---|---|---|
| `pnpm -F chrome-extension test` | PASS 174/174 | Unit + TaskManager journeys |
| `@extension/sidepanel` type-check | PASS | |
| `@extension/storage` type-check | PASS | |
| `chrome-extension` type-check | Pre-existing only | `helper.ts:24` `completionWithRetry`; test mock typing in experiments file |
| `RUNS=1 e2e:action-agent` | PASS once | form + reconnect + skill + media + privacy |
| `RUNS=10 e2e:action-agent` | NOT YET | Intermittent MiniMax / media / multi-run isolation failures; hardening applied |

### Deterministic fixture journeys (Chrome for Testing + MiniMax-M3)

Scenario coverage in `chrome-extension/scripts/action-agent-e2e.mjs`:

1. Form fill → external-commit approval → verified receipt
2. Side panel close/reopen → same completed receipt
3. Save Skill → reverse field order → rerun with new input → second submit
4. Media play → follow-up pause → media paused
5. Privacy: no `chat_agent_step_*`; no form sentinels outside user chat keys

Observed pass (single run, 2026-07-14 ~23:40 local):

- form PASS / reconnect PASS / skill PASS / media PASS / privacy PASS

Hardening applied this session:

- SidePanel: create chat session when follow-up has no `chatSessionId` (fixes multi-run after Skill: `Failed to persist task instruction`)
- Planner prompt: `login_required` only for real auth walls, not ordinary Name/Submit forms
- E2E: fail-fast on real `failed`/`waiting_user`; per-run storage reset; ensure `goal-send` before media follow-up

### Residual failure categories (automated)

| Category | Example | Handling |
|---|---|---|
| model | false `login_required` on fixture form | Planner prompt tightened; re-measure on RUNS=10 |
| model | skill run stops after `input_text` | Retried; often recovers next run |
| environment | media `goal-send` missing / CDP protocol timeout | E2E ensure-send + stop residual busy |
| product (fixed) | multi-run after skill without session | SidePanel session create path |

## Privacy / replay sweep

Runtime (non-test) match for `chat_agent_step_` only in migration cleanup (`packages/storage/lib/chat/history.ts`). No `JSON.stringify(actionArgs)` in production paths. Fixture sentinels appear only in tests and the e2e runner by design.

## Owner journeys (Feishu / Bilibili)

Not run this session. Protocol from PRD / plan Story 7 Step 6:

```bash
pnpm --dir projects/nanobrowser build
mkdir -p .tmp/scion-owner-acceptance
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --user-data-dir="$PWD/.tmp/scion-owner-acceptance" \
  --disable-extensions-except="$PWD/projects/nanobrowser/dist" \
  --load-extension="$PWD/projects/nanobrowser/dist"
```

Record 10 attempts each; pass bar ≥8/10 verified; zero false completed; zero unapproved external commits.

## Design status decision

Keep `docs/design/001-browser-action-task-runtime.md` as `not-implemented` until:

1. `RUNS=10` fixture gate is green, and
2. Owner Feishu + Bilibili fixed-protocol results are recorded here.

## Next actions

1. Land Story 7 product/e2e hardening commits.
2. Re-run `RUNS=10 pnpm --dir projects/nanobrowser e2e:action-agent` after commit.
3. Owner login acceptance for Feishu form + Bilibili media.
4. Only then flip design status to `current` and regenerate docs index.
