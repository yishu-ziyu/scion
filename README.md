# oss-forks

Personal second-development (二开) lab for open-source tools.

Maintainer: yishu-ziyu

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
