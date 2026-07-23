# scion · 持节

Personal lab monorepo for **持节 (Chijie)** — a Chrome MV3 browser action agent.

**scion** (接穗): grafts on open-source rootstock. The only living extension graft is Nanobrowser-derived code under `projects/chijie-browser/`.

Maintainer: yishu-ziyu · remote: https://github.com/yishu-ziyu/scion

## What this repo is

| Path | Role |
|------|------|
| `projects/chijie-browser/` | Sole extension monorepo (edit + build + Load unpacked `dist/`) |
| `docs/` | Product, design, decisions (indexed) |
| `reports/` | E2E / run evidence (folder name `nanobrowser` is historical) |
| `experiments/` | Optional bake-offs; not the ship path |

Product one-liner: multi-step web tasks in **daily Chrome**, human-readable steps, approval for irreversible commits, **verified completion** only with page evidence.

## Start here

| Doc | When |
|-----|------|
| [ENGINEERING.md](./ENGINEERING.md) | Hygiene bar, layout, git, “clean enough for second-dev” |
| [AGENTS.md](./AGENTS.md) | Rules for coding agents |
| [CONTEXT.md](./CONTEXT.md) | Product vocabulary (Task, receipt, external commit, …) |
| [docs/DOCS_INDEX.md](./docs/DOCS_INDEX.md) | Numbered product/design docs |
| [HANDOVER.md](./HANDOVER.md) | Long ops: MiniMax inject, CDP, log capture |
| [projects/chijie-browser/PRODUCT.md](./projects/chijie-browser/PRODUCT.md) | Brand / naming |

## Quick start (extension)

```bash
cd projects/chijie-browser   # same as ~/projects/chijie-browser if symlink exists
pnpm install
# secrets (gitignored): chrome-extension/src/personal/secrets.local.ts
# copy from secrets.local.example.ts if missing; or run inject via build
pnpm build
```

Chrome → **Extensions → Load unpacked** →  
`projects/chijie-browser/dist`  
(same inode as `~/projects/chijie-browser/dist` when the symlink is set).

```bash
pnpm type-check
pnpm lint
pnpm -F chrome-extension test
pnpm dev                    # watch
```

Node `>=22.12.0`, package manager **pnpm only** (see `.nvmrc` under the extension tree).

## Local path notes

Canonical disk path on this machine:

```text
/Users/mahaoxuan/Desktop/AI产品经理/自研产品/scion
```

Optional symlinks:

- `~/projects/scion` → this directory
- `~/projects/chijie-browser` → `projects/chijie-browser`
- `~/projects/oss-forks` → this directory (legacy alias)

**One tree only.** Do not recreate a second full copy of the extension outside this repo.

## Upstream

Graft rootstock: [nanobrowser/nanobrowser](https://github.com/nanobrowser/nanobrowser).  
Frozen upstream marketing copies: [docs/upstream/nanobrowser/](./docs/upstream/nanobrowser/).

## License

Extension graft retains upstream LICENSE under `projects/chijie-browser/LICENSE`.  
Lab docs and product writing in this root are owner-maintained.
