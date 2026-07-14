# P1 Stagehand bake-off (MiniMax)

Not production. Uses **local Chrome** + **MiniMax-M3** via OpenAI-compatible API.

## Model / key (already on your machine)

Harness reads, in order:

1. Process env (`MINIMAX_API_KEY`, `MINIMAX_TOKEN_PLAN_KEY`, …)
2. `~/.config/ai-providers/env.local` (same as Nanobrowser e2e)
3. Optional gitignored `projects/nanobrowser/.../secrets.local.ts`

Defaults:

| Item | Value |
|---|---|
| Base URL | `https://api.minimaxi.com/v1` |
| Model | `MiniMax-M3` |
| Auth | `Authorization: Bearer <key>` |

No Browserbase key. No need to paste keys into this folder if `env.local` is set.

## Setup

```bash
cd experiments/agent-core-bakeoff/p1-stagehand
npm install   # already done if node_modules exists
```

## Run fixtures

```bash
# Form: fill → one-use approval → verify "Saved successfully"
AUTO_APPROVE=1 npm run fixture:form

# Media: play → pause
npm run fixture:media
```

Interactive approval (no AUTO_APPROVE): type `y` when prompted before submit.

## What this is for

Bake-off protocol: `docs/product/002-agent-core-bakeoff.md`  
Goal: mid/simple model + strong control layer; not “buy a flagship model to mask a bad core”.
