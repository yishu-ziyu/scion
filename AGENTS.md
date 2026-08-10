# scion — lab rules for agents

Personal second-dev lab (接穗) for **持节 / Chijie**.
Maintainer: yishu-ziyu · remote: `origin` → https://github.com/yishu-ziyu/scion.git

Deeper `projects/<name>/AGENTS.md` wins inside that tree.
Global `~/.grok/AGENTS.md` still applies for voice and safety.

**Hygiene:** [ENGINEERING.md](./ENGINEERING.md)
**Ops (CDP / inject / E2E):** [HANDOVER.md](./HANDOVER.md)
**Vocabulary:** [CONTEXT.md](./CONTEXT.md)
**Doc index:** [docs/DOCS_INDEX.md](./docs/DOCS_INDEX.md)

---

## Current product truth (conflict order)

When documents disagree, **later rows lose**. Historical docs never override this chain.

```text
1. docs/product/021-long-horizon-task-agent.md
   North star: long-horizon task Agent in the user's Chrome.
2. docs/decisions/004-task-scoped-autonomy.md
   Execution: task-scoped autonomy; no step-by-step approval gates.
3. docs/product/020-eval-master.md
   Eval contract and task_id registry.
4. docs/product/019-ai-agent-book-build-plan.md
   Harness / Evaluation / Observability / Outer Loop roadmap.
5. .ship/tasks/plan-large-nanobrowser-second-development/control/run_state.yaml
   Live execution status only — must not contradict 1–4.
```

**Product one-liner:** 持节 = Chrome MV3 **long-horizon task Agent** (mission/plan, task-scoped autonomy, verified delivery). Not a sidebar chatbot. Not a Claw-30 demo product.

**Historical only (never re-promote as north star):** `003`, `011`, `016`, `017`, `018`, old approval UX, Tabbit parity-as-goal, Claw 30 as product focus. Keep for research/eval history.

---

## Docs-driven rule (hard)

1. Before coding product behavior, open **021** and confirm `current_milestone` in `run_state.yaml`.
2. Every change maps to a gate **G#**, 019 wave, or 021 requirement; else update docs first.
3. Official scores use **MiniMax-M3**. Model `done` is never verified completion without browser evidence.
4. Finish the named milestone before starting the next.
5. Do **not** restore default external-commit approval blocking (decision 004).

---

## Overview

| Path | Role |
|------|------|
| `projects/chijie-browser/` | Sole extension monorepo (edit / build / Load unpacked `dist/`) |
| `reports/<name>/` | E2E and eval evidence |
| `docs/` | Product, design, decisions |
| `CONTEXT.md` | Shared product language |
| `HANDOVER.md` | Runtime ops continuity |

Active graft: **持节** under `projects/chijie-browser/` (Nanobrowser rootstock).

---

## Commands (lab root)

No root package manager. Work inside the project:

```bash
cd projects/chijie-browser
# symlink: ~/projects/chijie-browser
pnpm install
pnpm build
pnpm -F chrome-extension test
```

Full command set: `projects/chijie-browser/AGENTS.md`.

---

## One tree (merged 2026-07-14)

| Role | Path |
|------|------|
| Canonical code + git | `scion` → `projects/chijie-browser/` |
| Short path (symlink) | `~/projects/chijie-browser` → same folder |
| Lab root symlink | `~/projects/scion` → scion root |

Edit once. Build once. Commit **only from scion root** to `origin` (`yishu-ziyu/scion`).
Do not invent a second extension tree or nested `.git` inside the graft.

---

## Boundaries

| Tier | Rule |
|------|------|
| Always | Evidence under `reports/` when verifying behavior |
| Always | Secrets out of git (`secrets.local.ts`, `.env*`, keys) |
| Always | Product terms from `CONTEXT.md` + truth chain above |
| Always | Prefer main Chrome + existing login state |
| Always | Single tree: only `projects/chijie-browser` (symlink OK) |
| Always | Verified completion = observable page evidence |
| Ask first | New top-level `projects/`; force-push; remote changes |
| Never | Treat model `done` as complete without browser evidence |
| Never | Reintroduce default approval modal flow against decision 004 |

---

## Product defaults (short)

- **Verified completion** = observable browser evidence; model text is not enough.
- **Task-scoped autonomy** = goal authorizes in-scope actions; stop/correct anytime; out-of-scope high risk needs explanation.
- **Skill** = reusable semantic recipe (inputs, outcome, policy); not replaying stale element indexes.
- **Carrier:** Chrome extension only (`docs/decisions/001`). Default production core: `control` (`docs/design/002`).
- **Claw 30 / 018:** historical eval asset and reference set, not the product north star.

---

## Lessons

- 2026-07-15: Owner talks product judgment, not eval theater. Eval is internal verification, not the product feature list.
- 2026-08-11: Entry docs must not re-promote 003/011/018 approval or Claw-30 parity as current north star when 021/004 already won.

## P team (roles)

- **P0** product decision · **P1** research · **P2** spec · **P3** implement · **P4** independent accept (PASS/FAIL with evidence).
