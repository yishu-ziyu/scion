# Engineering standards — scion / 持节

This document is the **repo hygiene and extension engineering contract**.
Day-to-day agent rules stay in [AGENTS.md](./AGENTS.md) and [projects/chijie-browser/AGENTS.md](./projects/chijie-browser/AGENTS.md).
Long runtime ops (CDP, MiniMax inject, log capture) stay in [HANDOVER.md](./HANDOVER.md).

## Product identity

| Layer | Name |
|-------|------|
| Product (UI / Chrome store voice) | **持节** (Chijie) |
| Lab monorepo | **scion** |
| Extension package folder | `projects/chijie-browser/` |
| Upstream rootstock | [nanobrowser/nanobrowser](https://github.com/nanobrowser/nanobrowser) |

Do not brand new user-facing strings as Nanobrowser, 奕枢, or OpenClaw.

## Clean bar (what “tidy” means here)

Aligned with a normal **Chrome MV3 monorepo** (pnpm + Turbo + Vite):

1. **One source tree** for the extension — no second clone to sync.
2. **Generated artifacts never committed** — `node_modules/`, `dist/`, `dist-zip/`, `.turbo/`, coverage.
3. **Secrets never committed** — `secrets.local.ts`, `.env*`, keys, pem.
4. **Front door is product-true** — root `README.md` and extension `README.md` describe 持节, not upstream marketing.
5. **Commands are package-defined only** — no invented scripts; prefer `pnpm -F <pkg> <script>`.
6. **Tests live next to code** — `**/__tests__/**/*.test.ts` under `chrome-extension` (Vitest).
7. **Docs have one index** — [docs/DOCS_INDEX.md](./docs/DOCS_INDEX.md); product work maps to a gate or numbered doc.
8. **Evidence has a home** — runtime / E2E notes under `reports/` (folder name `nanobrowser` is historical; product name is 持节).
9. **No editor/OS junk** — `.DS_Store`, `.idea/`, stray `*.bak*`.
10. **WIP is visible** — unfinished features either land behind tests or stay uncommitted; do not half-merge silent branches into `main` without note.

## Layout (canonical)

```text
scion/
  README.md                 # human front door
  ENGINEERING.md            # this file
  AGENTS.md                 # agent lab rules
  CONTEXT.md                # product vocabulary
  HANDOVER.md               # long ops continuity (CDP, inject, E2E)
  docs/                     # product / design / decisions
    DOCS_INDEX.md
    upstream/nanobrowser/   # frozen upstream marketing docs
  projects/
    chijie-browser/         # sole extension monorepo (build here)
      chrome-extension/     # MV3 background + agent + browser control
      pages/                # side-panel, options, content
      packages/             # shared libs (i18n, storage, ui, …)
      dist/                 # Load unpacked target (generated)
  reports/                  # run evidence (not product docs)
  experiments/              # optional bake-offs; not the ship path
```

## Daily commands

```bash
cd projects/chijie-browser   # or: cd ~/projects/chijie-browser
pnpm install
pnpm build                  # inject personal secrets → clean dist → turbo build
pnpm dev                    # watch mode
pnpm type-check
pnpm lint
pnpm -F chrome-extension test
```

Chrome: **Extensions → Load unpacked → `projects/chijie-browser/dist`**.

Symlinks (optional shortcuts, same inode):

- `~/projects/scion` → this repo
- `~/projects/chijie-browser` → `projects/chijie-browser`

## Git rules

- Commit from **scion root** only.
- Small, factual commits; no AI co-author trailers.
- Do not force-push `main` without an explicit ask.
- Do not nest a second `.git` inside `projects/chijie-browser`.

## Before secondary development

Checklist:

- [ ] `git status` is understood (no mystery WIP or secrets staged)
- [ ] `pnpm build` succeeds from `projects/chijie-browser`
- [ ] `pnpm -F chrome-extension test` is green for the area you touch
- [ ] Extension loads from `dist/` and side panel opens
- [ ] Active product doc / gate for the change is named (or docs updated first)

## Out of hygiene scope (do not “clean” by deleting)

- Uncommitted feature work the owner still wants
- Local `secrets.local.ts` and `node_modules` / `dist` on disk
- Outside-repo backups such as `~/projects/chijie-browser.bak-*` (ask before delete)
- `.ship/` task history and `reports/` evidence (archive, do not invent a second system)
