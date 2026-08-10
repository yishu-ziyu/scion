# 持节 (chijie-browser) — agent rules

Chrome MV3 **long-horizon task agent** (pnpm + Turbo monorepo). Product name: **持节 / Chijie**.
Upstream rootstock: https://github.com/nanobrowser/nanobrowser · package version in `package.json`.

Lab parent: `../../AGENTS.md` · hygiene: `../../ENGINEERING.md` · ops: `../../HANDOVER.md` · product terms: `../../CONTEXT.md` · brand: `PRODUCT.md`

**Product truth (do not invent a second one):**

```text
021 north star → decision 004 autonomy → 020 eval → 019 roadmap → run_state
```

Historical docs (003, 011, 016–018, old approval UX) never override that chain.
Open `../../docs/product/021-long-horizon-task-agent.md` before coding product behavior.

This file is **ops for the extension monorepo**. MiniMax / CDP detail lives in HANDOVER.
**Single tree:** this directory is the only copy; `~/projects/chijie-browser` is a symlink here.

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
Do **not** reintroduce default external-commit approval gates (decision 004).

---

## Project structure

```text
chrome-extension/          # MV3 background + agent + browser control
  src/background/agent/    # control / nano drivers + executor
  src/background/browser/  # DOM / tab automation
  src/personal/            # scion personal bootstrap (MiniMax, secrets)
pages/side-panel/          # main task UI (React + Tailwind)
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
| Always | Follow lab truth chain (021 / 004 / 020 / 019); no second Task/Agent loop |
| Ask first | New production dependencies |
| Ask first | File renames/moves/deletes across workspaces |
| Ask first | Edit `turbo.json`, `pnpm-workspace.yaml`, root/workspace `tsconfig*`, global permissions |
| Ask first | Change personal bootstrap multi-provider policy (`src/personal/config.ts` + bootstrap overwrite) |
| Never | Edit generated: `dist/**`, `build/**`, `packages/i18n/lib/**` |
| Never | Commit `secrets.local.ts` or print full keys |
| Never | Use `eval` / dynamic code that breaks MV3 CSP |
| Never | Treat model `done` as verified completion without page evidence |

Secrets inject order (do not reorder casually):
`~/.config/ai-providers/env.local` → `~/.config/ai-providers/.env` → repo `.env.local` → process env.
Details: `HANDOVER.md` §5.

---

## Decision tables

### Where to edit

| Goal | Tree |
|------|------|
| Ship code to GitHub scion | Edit → commit in **scion** root |
| Build/load into Chrome today | **`~/projects/chijie-browser`** (same files) |
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
| Default execution core | **`control`** (design 002); `nano` demotable |

---

## Personal layer map (scion-specific)

```text
chrome-extension/src/personal/
  config.ts bootstrap.ts secrets.local.example.ts  # secrets.local.ts gitignored
chrome-extension/scripts/inject-personal-secrets.mjs
```

Key reliability files:
`agent/agents/base.ts` · `messages/utils.ts` · `actions/schemas.ts` · `executor.ts` · `agents/planner.ts`
Task shell: `task/manager.ts` · `task/action-dispatcher.ts` · `task/completion.ts`

Full change list + CDP commands: **`../../HANDOVER.md`**.

---

## Progressive disclosure

| Need | Open |
|------|------|
| Dual tree, CDP, E2E status | `../../HANDOVER.md` |
| Product vocabulary | `../../CONTEXT.md` |
| North star | `../../docs/product/021-long-horizon-task-agent.md` |
| Autonomy | `../../docs/decisions/004-task-scoped-autonomy.md` |
| Eval contract | `../../docs/product/020-eval-master.md` |
| Harness roadmap | `../../docs/product/019-ai-agent-book-build-plan.md` |
| Why Chrome extension | `../../docs/decisions/001-keep-chrome-extension.md` |
| Production core swap (default `control`) | `../../docs/design/002-production-core-swap.md` |
| Task runtime shell (partially outdated) | `../../docs/design/001-browser-action-task-runtime.md` |
| E2E evidence index | `../../reports/nanobrowser/` |

---

## Lessons

- 2026-07-24: URL completion must not pass on 404 / soft-404 shells. Use `pageLooksUnavailable` in URL probes; empty observation value fails starts_with/equals.
- 2026-08-11: Claw 30 / 018 is a **historical eval asset**, not mandatory product north-star work. Do not block long-horizon work to “finish the 30.” Do not re-teach step approval as default UX.
