# scion

Personal second-development (二开) lab for open-source tools.

**scion** (接穗): the shoot grafted onto a rootstock.
Upstream is the trunk; this repo holds the living grafts.

Maintainer: yishu-ziyu

## Local path

```
/Users/mahaoxuan/Desktop/AI产品经理/自研产品/scion
```

Symlinks:

- `~/projects/scion` → this directory (preferred)
- `~/projects/oss-forks` → same path (compat alias)
- `~/projects/nanobrowser` → `projects/nanobrowser` (same folder; Chrome Load unpacked path)

**One tree:** extension code lives only under `projects/nanobrowser/`. No second copy to sync.

## Layout

```
projects/          # forked / customized codebases
  nanobrowser/     # AI browser agent extension (MiniMax / zh-CN / harness) — sole build tree
reports/           # E2E notes, design decisions, run evidence indexes
  nanobrowser/
```

## Projects

| Project | Upstream | Status | Notes |
|---------|----------|--------|-------|
| [nanobrowser](./projects/nanobrowser) | [nanobrowser/nanobrowser](https://github.com/nanobrowser/nanobrowser) | active | MiniMax-M3 Token Plan, zh_CN, CDP E2E, think-tag JSON fix |

## Handover for agents (Codex etc.)

Rules (lean, layered):

- Lab: **[AGENTS.md](./AGENTS.md)**
- Extension monorepo: **[projects/nanobrowser/AGENTS.md](./projects/nanobrowser/AGENTS.md)**
- Ops narrative: **[HANDOVER.md](./HANDOVER.md)** (single tree, MiniMax, CDP, E2E)

`CLAUDE.md` under nanobrowser is a thin pointer to `AGENTS.md` only.

## How we work

1. Code lives under `projects/<name>/`.
2. Run notes, E2E evidence indexes, and product decisions go under `reports/<name>/`.
3. Never commit API keys. Use `secrets.local.example.ts` / env files outside git.
4. Prefer small, reversible commits; push to this remote as `origin`.

## Nanobrowser quick start (local)

```bash
cd projects/nanobrowser   # or: cd ~/projects/nanobrowser  (symlink)
pnpm install
# copy personal secrets (gitignored) if missing
# cp chrome-extension/src/personal/secrets.local.example.ts \
#    chrome-extension/src/personal/secrets.local.ts
pnpm build
# Chrome → Load unpacked → ~/projects/nanobrowser/dist
# (same as scion/projects/nanobrowser/dist)
```

See [reports/nanobrowser/](./reports/nanobrowser/) for E2E and ops notes.
