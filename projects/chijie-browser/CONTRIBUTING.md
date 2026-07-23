# Contributing to 持节 (this graft)

This directory is a **personal product graft** inside [scion](https://github.com/yishu-ziyu/scion), not the public Nanobrowser community repo.

## For work on 持节

1. Edit only under `projects/chijie-browser/` (this folder).
2. Commit from the **scion root**.
3. Follow [ENGINEERING.md](../../ENGINEERING.md) and [AGENTS.md](./AGENTS.md).
4. Map product changes to a gate or numbered doc under `docs/` when behavior changes.

```bash
pnpm install
pnpm build
pnpm -F chrome-extension test
```

## Upstream Nanobrowser

Contributions intended for upstream Nanobrowser should go to  
https://github.com/nanobrowser/nanobrowser — not this lab remote.

## License

Upstream LICENSE terms for this graft are in [LICENSE](./LICENSE).
