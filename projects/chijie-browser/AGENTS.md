# 持节 (chijie-browser) — agent rules

Chrome MV3 browser action agent (pnpm + Turbo monorepo). Product name: **持节 / Chijie**.
Upstream rootstock: https://github.com/nanobrowser/nanobrowser · package version in `package.json`.

Lab parent: `../../AGENTS.md` · hygiene: `../../ENGINEERING.md` · ops: `../../HANDOVER.md` · product terms: `../../CONTEXT.md` · brand: `PRODUCT.md`

**Product docs (drive work):** `../../docs/README.md` → `../../docs/product/003-north-star.md` + `004-docs-driven-dev.md` + `001-nanobrowser-prd.md`.

This file is **ops for the extension monorepo**. MiniMax / CDP detail lives in HANDOVER — open it for runtime continuity, not as chat filler.
**Single tree:** this directory is the only copy; `~/projects/chijie-browser` is a symlink here.

When implementing product behavior, prefer PRD + north-star gates over historical Nano upstream patterns.
User-facing brand strings: **持节**, not Nanobrowser / 奕枢 / OpenClaw.

---

## Commands

Package manager: **pnpm only**. Node: `>=22.12.0` (see `.nvmrc`; `nvm use` before install).

```bash
# From this directory (same as ~/projects/chijie-browser via symlink)
pnpm install
pnpm inject:personal    # writes gitignored secrets.local.ts from env sources
pnpm build              # inject → clean dist → turbo ready/build
pnpm dev                # inject + turbo watch (__DEV__)
pnpm type-check
pnpm lint
pnpm prettier
pnpm -F chrome-extension test
pnpm -F chrome-extension test -- -t "Sanitizer"   # targeted
pnpm zip                # build + zip → dist-zip/
pnpm e2e                # build + zip + turbo e2e
```

Prefer workspace-scoped runs:

```bash
pnpm -F chrome-extension build
pnpm -F chrome-extension type-check
pnpm -F pages/side-panel lint -- src/components/ChatInput.tsx
pnpm -F packages/storage type-check
```

Only use scripts defined in `package.json`. Do not invent commands.

---

## Testing

| Kind | How |
|------|-----|
| Unit | Vitest under `chrome-extension/src/**/__tests__/**/*.test.ts` |
| Run | `pnpm -F chrome-extension test` |
| Manual extension | Load unpacked `dist/` in Chrome/Edge; reload card after rebuild; reopen side panel |
| Real E2E | Main Chrome CDP (see HANDOVER); evidence under `../../reports/nanobrowser/` |

Prefer fast, deterministic unit tests; mock network/browser APIs.
Verified completion needs **browser evidence**, not model `done`.

---

## Project structure

```text
chrome-extension/          # MV3 background + agent + browser control
  src/background/agent/    # Navigator / Planner / Validator + executor
  src/background/browser/  # DOM / tab automation
  src/personal/            # scion personal bootstrap (MiniMax, secrets)
pages/side-panel/          # main chat UI (React + Tailwind)
pages/options/             # settings UI
pages/content/             # content script
packages/                  # shared, storage, ui, i18n, schema-utils, …
dist/                      # unpacked extension output (generated)
```

Load extension from **`dist/`** after build.
i18n: edit `packages/i18n/locales/**` only — never hand-edit `packages/i18n/lib/**` (generated).

---

## Code style (deltas that matter)

- TypeScript strict; React 18; Prettier: 2 spaces, semicolons, single quotes, trailing commas, `printWidth: 120`
- `import type { X } from '...'` for type-only imports
- Components `PascalCase`; functions/vars `camelCase`; packages `kebab-case`
- Reuse `packages/ui` and `packages/tailwind-config` — do not reimplement
- Vite aliases: extension `@root` `@src` `@assets`; pages `@src` via `withPageConfig`

i18n keys: `component_category_action_state`  
Prefixes: `bg_` `exec_` `act_` `errors_` `options_` `chat_` `nav_` `permissions_`  
Suffixes: `_start` `_ok` `_fail` `_cancel` `_pause`

```typescript
import { t } from '@extension/i18n';
t('bg_errors_noTabId');
t('act_click_ok', ['5', 'Submit Button']);
```

---

## Git / change policy

- Minimal scoped diffs; no mass reformat
- Edit and build **here** (or via `~/projects/chijie-browser` symlink - same files)
- Commit from **scion root** only (`yishu-ziyu/scion`); no nested `.git` in this graft
- No AI co-author on commits

---

## Boundaries

| Tier | Rule |
|------|------|
| Always | `pnpm` only; run type-check/lint on touched workspaces before claiming done |
| Always | Keep secrets out of git and logs (`secrets.local.ts`, full API keys) |
| Always | Preserve think-tag strip + manual JSON parse for MiniMax/custom_openai mid models |
| Always | Prefer main Chrome login state; do not invent a blank test profile |
| Ask first | New production dependencies |
| Ask first | File renames/moves/deletes across workspaces |
| Ask first | Edit `turbo.json`, `pnpm-workspace.yaml`, root/workspace `tsconfig*`, global permissions |
| Ask first | Change personal bootstrap multi-provider policy (`src/personal/config.ts` + bootstrap overwrite) |
| Never | Edit generated: `dist/**`, `build/**`, `packages/i18n/lib/**` |
| Never | Commit `secrets.local.ts` or print full keys |
| Never | Use `eval` / dynamic code that breaks MV3 CSP |

Secrets inject order (do not reorder casually):  
`~/.config/ai-providers/env.local` → `~/.config/ai-providers/.env` → repo `.env.local` → process env.  
Details: `HANDOVER.md` §5.

---

## Decision tables

### Where to edit

| Goal | Tree |
|------|------|
| Ship code to GitHub scion | Edit/sync → commit in **scion** |
| Build/load into Chrome today | **`~/projects/chijie-browser`** |
| E2E notes / product docs | **scion** `reports/` `docs/` `CONTEXT.md` |

### Personal provider layer

| Goal | Do |
|------|----|
| Keep self-use MiniMax default | Leave `ensurePersonalDefaults()` overwrite policy |
| Add second provider | Explicit change in `config.ts` + bootstrap; document in HANDOVER |
| Fix mid-model JSON | Keep base agent parse path (strip `<think>`, extract JSON, coerce schemas) — do not re-enable blind structured output for MiniMax |

### Architecture carrier (lab decision)

| Option | Choice |
|--------|--------|
| Chrome extension in daily browser | **Yes** (ADR 001) |
| Fork Chromium / cloud browser | **No** — plugin is the final product form |

---

## Personal layer map (scion-specific)

```text
chrome-extension/src/personal/
  config.ts bootstrap.ts secrets.local.example.ts  # secrets.local.ts gitignored
chrome-extension/scripts/inject-personal-secrets.mjs
```

Key reliability files:  
`agent/agents/base.ts` · `messages/utils.ts` · `actions/schemas.ts` · `executor.ts` · `agents/planner.ts`

Full change list + CDP commands: **`../../HANDOVER.md`**.

---

## Progressive disclosure

| Need | Open |
|------|------|
| Dual tree, CDP, E2E status | `../../HANDOVER.md` |
| Product vocabulary | `../../CONTEXT.md` |
| Why Chrome extension | `../../docs/decisions/001-keep-chrome-extension.md` |
| Task runtime (L4 shell; partially-outdated) | `../../docs/design/001-browser-action-task-runtime.md` |
| Production core swap (default `control`) | `../../docs/design/002-production-core-swap.md` |
| Tabbit-class task loop index | `../../docs/product/008-tabbit-class-agent-task-loop-spec.md` |
| Calm task console (visual/three-state) | `../../docs/design/004-chijie-calm-task-console.md` |
| E2E evidence index | `../../reports/nanobrowser/` |
| Upstream-style long style essay (backup) | `AGENTS.md.bak-20260714` |

---

## Lessons

- 2026-07-23: Sider Claw 30 demos are mandatory live scorecard work (`docs/product/018`), not optional research. Do not substitute a small tracer set for the full 30; do not push personalization ahead of 018; do not claim parity while rows stay `not_run`. Update 018 after every case run.
- 2026-07-24: URL completion must not pass on 404 / soft-404 shells (e.g. YouTube `playlist?list=FL` + "This page isn't available"). Use `pageLooksUnavailable` in URL probes; empty observation value fails starts_with/equals.
