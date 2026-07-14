# scion — lab rules for agents

Personal second-dev lab (接穗). Upstream is the rootstock; this repo holds grafts.
Maintainer: yishu-ziyu · remote: `origin` → https://github.com/yishu-ziyu/scion.git

Deeper `projects/<name>/AGENTS.md` wins for work inside that tree.
Global `~/.grok/AGENTS.md` still applies for communication and safety.

**Read first for Nanobrowser runtime continuity:** [HANDOVER.md](./HANDOVER.md)
**Product vocabulary:** [CONTEXT.md](./CONTEXT.md)
**Doc index:** [docs/DOCS_INDEX.md](./docs/DOCS_INDEX.md)

---

## Overview

| Path | Role |
|------|------|
| `projects/<name>/` | Forked / customized code (tracked snapshot) |
| `reports/<name>/` | E2E notes, decisions indexes, run evidence |
| `docs/` | Design + ADR (ship-managed index) |
| `CONTEXT.md` | Shared product language (browser action agent, Task, Skill…) |
| `HANDOVER.md` | Live ops for Nanobrowser dual-tree + MiniMax + CDP |

Active project: **nanobrowser** under `projects/nanobrowser/`.

---

## Commands (lab root)

There is no root package manager. Work inside the project:

```bash
cd projects/nanobrowser   # or ~/projects/nanobrowser for runtime build
pnpm install
pnpm build
pnpm -F chrome-extension test
```

Full command set: `projects/nanobrowser/AGENTS.md`.

---

## Critical decision: two trees

| Role | Path | Use for |
|------|------|---------|
| **This git lab** | `/Users/mahaoxuan/Desktop/AI产品经理/自研产品/scion` (`~/projects/scion`) | Edit product docs, commit, push to `yishu-ziyu/scion` |
| **Runtime build** | `/Users/mahaoxuan/projects/nanobrowser` | `pnpm build`, load unpacked `dist/`, Chrome CDP E2E |

| When | Do |
|------|----|
| Change product docs / design / reports | Edit in **scion** |
| Change extension runtime behavior | Prefer edit+build in **`~/projects/nanobrowser`**, then sync tracked paths into `scion/projects/nanobrowser` |
| Commit / push | **Only from scion** to `origin` |
| Secrets / dist / node_modules | Never commit (root `.gitignore`) |

Do **not** invent a second empty Chrome profile for Nanobrowser tests.
Do **not** point upstream Nanobrowser remote at scion without an explicit owner decision.

Sync after a coherent change set (tracked paths only; no `node_modules`, `dist`, `secrets.local.ts`).
File map: `HANDOVER.md` §6.

---

## Project structure

```text
scion/
  AGENTS.md              # this file
  CONTEXT.md             # product terms
  HANDOVER.md            # nanobrowser ops handover
  docs/                  # decisions + design
  projects/nanobrowser/  # code graft (see its AGENTS.md)
  reports/nanobrowser/   # E2E + ops notes
```

---

## Git workflow

- Small, reversible commits on scion `main`
- Conventional, factual messages (what changed and why)
- Never auto-add AI co-author
- Push only to scion `origin` unless the user says otherwise
- Upstream Nanobrowser history stays separate in the runtime tree

---

## Boundaries

| Tier | Rule |
|------|------|
| Always | Put run evidence under `reports/<name>/` when you verify behavior |
| Always | Keep secrets out of git (`secrets.local.ts`, `.env*`, keys) |
| Always | Use product terms from `CONTEXT.md` for product talk |
| Always | Prefer main Chrome + existing login state for browser-action work |
| Ask first | New top-level projects under `projects/` |
| Ask first | Changing dual-tree workflow or relocating the runtime tree |
| Ask first | Force-push, rewriting published history, changing remotes |
| Never | Commit API keys or print full keys in logs/chat |
| Never | Treat model `done` as verified completion without browser evidence |

---

## Product defaults (scion)

From `CONTEXT.md` and `docs/decisions/001`:

- **Browser action agent** = operate pages until a **verifiable** outcome — not a page shortcut or sidebar chatbot
- **Verified completion** = observable browser evidence; model text is not enough
- **Skill** = reusable semantic recipe (inputs, outcome, approval); not replaying stale element indexes
- This cycle: keep **Chrome extension** as the carrier (no fork Chromium, no cloud browser)

Design not yet implemented: `docs/design/001-browser-action-task-runtime.md` — load when building task runtime / continuous control / local Skill.

---

## Writing project AGENTS.md

Follow global meta-standard (`~/.grok/docs/reference-agents-md-authoring.md`).
Keep each project file ~100–150 lines; point to HANDOVER / reports for long ops narrative.
