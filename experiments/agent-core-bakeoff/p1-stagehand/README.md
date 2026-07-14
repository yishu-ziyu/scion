# P1 Stagehand bake-off harness

Not production. Product path stays under `projects/nanobrowser` until bake-off decides and L4 is wired.

## Goal

Prove **mid-tier models** + Stagehand local control can:

1. Form: fill → **approval before submit** → one verified success (`Saved successfully`)
2. Media: play → follow-up pause → `paused === true`

Rules from `docs/product/002-agent-core-bakeoff.md`:

- **No P0** (do not validate “only stronger models on Nano Core”)
- Quality first: zero false complete, zero unapproved commit

## Setup

```bash
cd experiments/agent-core-bakeoff/p1-stagehand
cp .env.example .env
# set OPENAI_API_KEY (or compatible) + STAGEHAND_MODEL mid-tier
pnpm install   # or npm install
```

## Run fixtures

```bash
# Interactive approval prompt
pnpm fixture:form

# CI-style one-use approval without human
AUTO_APPROVE=1 pnpm fixture:form

pnpm fixture:media
```

## Next

1. Stabilize fixture matrix rows into `reports/nanobrowser/bakeoff/`
2. Owner T1/T2 on Feishu + Bilibili with same scoring
3. If P1 gates pass → design production adapter: Stagehand/CDP under TaskManager, delete Nano Planner loop
