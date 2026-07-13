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

## Layout

```
projects/          # forked / customized codebases
  nanobrowser/     # AI browser agent extension (MiniMax / zh-CN / harness)
reports/           # E2E notes, design decisions, run evidence indexes
  nanobrowser/
```

## Projects

| Project | Upstream | Status | Notes |
|---------|----------|--------|-------|
| [nanobrowser](./projects/nanobrowser) | [nanobrowser/nanobrowser](https://github.com/nanobrowser/nanobrowser) | active | MiniMax-M3 Token Plan, zh_CN, CDP E2E, think-tag JSON fix |

## Handover for agents (Codex etc.)

Start here: **[HANDOVER.md](./HANDOVER.md)**.

It covers dual trees (`scion` vs `~/projects/nanobrowser`), MiniMax bootstrap, CDP rules, E2E status, and next work.

## How we work

1. Code lives under `projects/<name>/`.
2. Run notes, E2E evidence indexes, and product decisions go under `reports/<name>/`.
3. Never commit API keys. Use `secrets.local.example.ts` / env files outside git.
4. Prefer small, reversible commits; push to this remote as `origin`.

## Nanobrowser quick start (local)

```bash
cd projects/nanobrowser
pnpm install
# copy personal secrets (gitignored)
# cp chrome-extension/src/personal/secrets.local.example.ts \
#    chrome-extension/src/personal/secrets.local.ts
pnpm build
# Chrome → Load unpacked → projects/nanobrowser/dist
```

See [reports/nanobrowser/](./reports/nanobrowser/) for E2E and ops notes.
