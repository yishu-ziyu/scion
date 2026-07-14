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
| `HANDOVER.md` | Live ops for Nanobrowser (single tree) + MiniMax + CDP |

Active project: **nanobrowser** under `projects/nanobrowser/`.

---

## Commands (lab root)

There is no root package manager. Work inside the project:

```bash
cd projects/nanobrowser
# same folder via symlink: ~/projects/nanobrowser
pnpm install
pnpm build
pnpm -F chrome-extension test
```

Full command set: `projects/nanobrowser/AGENTS.md`.

---

## Critical decision: one tree (merged 2026-07-14)

| Role | Path | Use for |
|------|------|---------|
| **Canonical code + git lab** | `scion` → `projects/nanobrowser/` | Edit, build, commit, push |
| **Short path (symlink)** | `~/projects/nanobrowser` → same folder | Same files; Chrome Load unpacked `dist/` |
| **Lab root symlink** | `~/projects/scion` → scion root | Docs / reports |

| When | Do |
|------|----|
| Change extension or design | Edit **once** under `projects/nanobrowser` (or via `~/projects/nanobrowser`) |
| Build / load Chrome | `pnpm build` then Load unpacked **`projects/nanobrowser/dist`** (same as `~/projects/nanobrowser/dist`) |
| Commit / push | **Only from scion root** to `origin` (`yishu-ziyu/scion`) |
| Secrets / dist / node_modules | Live on disk; never commit (root `.gitignore`) |

Do **not** invent a second empty Chrome profile for Nanobrowser tests.
Do **not** recreate a second full copy of the extension outside scion.
Do **not** point an upstream Nanobrowser `origin` inside this graft without an explicit owner decision.

Old dual-tree backup (read-only, can delete later): `~/projects/nanobrowser.bak-*` (kept upstream `.git` history).

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
- Extension graft has **no nested `.git`**; history is scion only (upstream history may exist only in `nanobrowser.bak-*`)

---

## Boundaries

| Tier | Rule |
|------|------|
| Always | Put run evidence under `reports/<name>/` when you verify behavior |
| Always | Keep secrets out of git (`secrets.local.ts`, `.env*`, keys) |
| Always | Use product terms from `CONTEXT.md` for product talk |
| Always | Prefer main Chrome + existing login state for browser-action work |
| Always | Single tree: edit/build only `projects/nanobrowser` (symlink OK) |
| Ask first | New top-level projects under `projects/` |
| Ask first | Breaking the `~/projects/nanobrowser` symlink or re-splitting trees |
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
