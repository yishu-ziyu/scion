# scion — lab rules for agents

Personal second-dev lab (接穗) for **持节 / Chijie**. Upstream is the rootstock; this repo holds grafts.
Maintainer: yishu-ziyu · remote: `origin` → https://github.com/yishu-ziyu/scion.git

Deeper `projects/<name>/AGENTS.md` wins for work inside that tree.
Global `~/.grok/AGENTS.md` still applies for communication and safety.

**Engineering hygiene (clean bar):** [ENGINEERING.md](./ENGINEERING.md)
**Read for runtime continuity (CDP / inject / E2E):** [HANDOVER.md](./HANDOVER.md)
**Product vocabulary:** [CONTEXT.md](./CONTEXT.md)
**Docs drive development:** [docs/README.md](./docs/README.md) → [docs/product/003-north-star.md](./docs/product/003-north-star.md) → [docs/product/004-docs-driven-dev.md](./docs/product/004-docs-driven-dev.md)
**Doc index:** [docs/DOCS_INDEX.md](./docs/DOCS_INDEX.md)

### Docs-driven rule (hard)

1. Before coding browser-agent features, open `docs/product/003-north-star.md` and confirm `current_milestone` in `.ship/tasks/plan-large-nanobrowser-second-development/control/run_state.yaml`.
2. Every change must map to a gate **G#** or a PRD requirement; otherwise update docs first.
3. Accuracy parity target: Meituan Tabbit public **Agent ~91.8%** / web-ops **≥70%** (see 003). Mid-model MiniMax-M3 for official scores.
4. Do not thrash: finish current M before starting the next.

---

## Overview

| Path | Role |
|------|------|
| `projects/<name>/` | Forked / customized code (tracked snapshot) |
| `reports/<name>/` | E2E notes, decisions indexes, run evidence |
| `docs/` | Design + ADR (ship-managed index) |
| `CONTEXT.md` | Shared product language (browser action agent, Task, Skill…) |
| `HANDOVER.md` | Live ops for Nanobrowser (single tree) + MiniMax + CDP |

Active project: **持节 (chijie-browser)** under `projects/chijie-browser/` (Nanobrowser graft).

---

## Commands (lab root)

There is no root package manager. Work inside the project:

```bash
cd projects/chijie-browser
# same folder via symlink: ~/projects/chijie-browser
pnpm install
pnpm build
pnpm -F chrome-extension test
```

Full command set: `projects/chijie-browser/AGENTS.md`.

---

## Critical decision: one tree (merged 2026-07-14)

| Role | Path | Use for |
|------|------|---------|
| **Canonical code + git lab** | `scion` → `projects/chijie-browser/` | Edit, build, commit, push |
| **Short path (symlink)** | `~/projects/chijie-browser` → same folder | Same files; Chrome Load unpacked `dist/` |
| **Lab root symlink** | `~/projects/scion` → scion root | Docs / reports |

| When | Do |
|------|----|
| Change extension or design | Edit **once** under `projects/chijie-browser` (or via `~/projects/chijie-browser`) |
| Build / load Chrome | `pnpm build` then Load unpacked **`projects/chijie-browser/dist`** (same as `~/projects/chijie-browser/dist`) |
| Commit / push | **Only from scion root** to `origin` (`yishu-ziyu/scion`) |
| Secrets / dist / node_modules | Live on disk; never commit (root `.gitignore`) |

Do **not** invent a second empty Chrome profile for Nanobrowser tests.
Do **not** recreate a second full copy of the extension outside scion.
Do **not** point an upstream Nanobrowser `origin` inside this graft without an explicit owner decision.

Old dual-tree backup (read-only, can delete later): `~/projects/chijie-browser.bak-*` (kept upstream `.git` history).

---

## Project structure

```text
scion/
  README.md / ENGINEERING.md / AGENTS.md
  CONTEXT.md             # product terms
  HANDOVER.md            # long ops (CDP, inject, E2E)
  docs/                  # product + design + decisions + upstream archive
  projects/chijie-browser/  # 持节 extension monorepo
  reports/nanobrowser/   # E2E + ops notes (historical folder name)
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
| Always | Single tree: edit/build only `projects/chijie-browser` (symlink OK) |
| Ask first | New top-level projects under `projects/` |
| Ask first | Breaking the `~/projects/chijie-browser` symlink or re-splitting trees |
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

Task runtime L4 shell is landed (TaskManager / ActionDispatcher / CompletionChecker); default production core is `control` (`docs/design/002`). `docs/design/001` remains partially-outdated historical architecture - load with `design/002` + `product/008` + `design/004` for current task loop and calm console.

---

## Lessons

- 2026-07-15: CEO 对话混入过多评测与实现细节，并把评测误当产品功能 → P0 与 Owner 只讨论简洁的产品判断；持节以 Chrome 插件为最终形态，对标 Tabbit 的能力与体验而非浏览器外壳；评测仅是委派给 P1–P4 的内部执行与验证手段。

## P team

- **P0 — 产品决策与整合：** 与 Owner 共同决定方向；派工、取舍、整合，只向 Owner 汇报产品结论。
- **P1 — 产品情报与用户研究：** 一手证据、用户任务、竞品事实、未知项与机会；不写代码。
- **P2 — 产品规格与体验：** 用 yishuship + Matt 把方向转成 Spec、旅程、优先级与 done；不承担大段实现。
- **P3 — 工程实现与诊断：** 在规格边界内编码、测试、调试和交付证据；不决定产品方向。
- **P4 — 独立验收与发布闸门：** 不参与实现；独立给出 PASS/FAIL，证据不足不放行。

---

## Writing project AGENTS.md

Follow global meta-standard (`~/.grok/docs/reference-agents-md-authoring.md`).
Keep each project file ~100–150 lines; point to HANDOVER / reports for long ops narrative.
