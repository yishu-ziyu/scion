# 持节 (Chijie) · Chrome extension

Verifiable **browser action agent** for daily Chrome (MV3 side panel).

This package is a personal graft of [nanobrowser/nanobrowser](https://github.com/nanobrowser/nanobrowser), productized as **持节**.  
Lab monorepo: [yishu-ziyu/scion](https://github.com/yishu-ziyu/scion).

| Layer | Value |
|-------|--------|
| Product | 持节 / Chijie |
| Package name | `chijie-browser` |
| Version | see `package.json` |
| Load unpacked | `./dist` after `pnpm build` |
| Brand note | [PRODUCT.md](./PRODUCT.md) |

## Requirements

- Node `>=22.12.0` (`.nvmrc`)
- **pnpm** only (`packageManager` field in `package.json`)

## Commands

```bash
pnpm install
pnpm build                 # inject personal secrets → clean dist → turbo build
pnpm dev                   # inject + turbo watch
pnpm type-check
pnpm lint
pnpm -F chrome-extension test
pnpm zip                   # build + zip → dist-zip/
```

Workspace-scoped examples:

```bash
pnpm -F chrome-extension build
pnpm -F chrome-extension test
pnpm -F pages/side-panel lint
```

Agent-oriented command detail: [AGENTS.md](./AGENTS.md).  
Lab hygiene and “clean bar”: [../../ENGINEERING.md](../../ENGINEERING.md).

## Layout

```text
chrome-extension/     # MV3 service worker, agent, browser control
  src/background/     # task loop, observe-act, DOM/tabs
  src/personal/       # MiniMax bootstrap + secrets.local.ts (gitignored)
pages/
  side-panel/         # main task UI
  options/            # settings
  content/            # content script
packages/             # i18n, storage, ui, schema-utils, …
dist/                 # generated — Load unpacked here
```

## Secrets

Never commit keys.

```bash
cp chrome-extension/src/personal/secrets.local.example.ts \
   chrome-extension/src/personal/secrets.local.ts
# fill values, or use inject:personal / env sources documented in lab HANDOVER
```

Env sample for analytics only: [`.env.example`](./.env.example).

## Product docs (lab root)

- Vocabulary: `../../CONTEXT.md`
- North star: `../../docs/product/003-north-star.md`
- Doc index: `../../docs/DOCS_INDEX.md`
- Upstream marketing archive: `../../docs/upstream/nanobrowser/`

## License

See [LICENSE](./LICENSE) (upstream Nanobrowser license retained for this graft).
