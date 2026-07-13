# HANDOVER: scion / Nanobrowser personal fork

**Audience:** Codex (or any agent) continuing development on this machine.  
**Owner:** yishu-ziyu  
**Date:** 2026-07-13  
**Status:** MiniMax-M3 personal fork is usable on main Chrome; multi-step Navigator E2E passed with known flaky mid-parse; extension-tab target isolation is closed through attach-time regression review.

Read this file first.
Then skim `reports/nanobrowser/2026-07-13-minimax-e2e-cdp.md`.
Do not invent a second empty Chrome profile for Nanobrowser tests.

---

## 1. One-sentence mission

Ship a personal Nanobrowser fork that runs on **main Chrome** with **MiniMax Token Plan (MiniMax-M3)**, Chinese UI, no GUI secret entry, and robust enough JSON handling for mid-tier models that emit `<think>` tags.

Broader product intent (later): BYOK AI browser agent (Planner / Navigator), Chrome first, multi-model package inventory later.

---

## 2. Where things live (critical)

There are **two trees**. Mixing them up is the #1 footgun.

| Role | Path | Notes |
|------|------|--------|
| **Lab monorepo (this git repo)** | `/Users/mahaoxuan/Desktop/AI产品经理/自研产品/scion` | GitHub: https://github.com/yishu-ziyu/scion |
| Symlink | `~/projects/scion` → same | Prefer this short path |
| Compat symlink | `~/projects/oss-forks` → same | Old name; keep until scripts die |
| **Active runtime build tree** | `/Users/mahaoxuan/projects/nanobrowser` | Has `node_modules`, `dist`, `secrets.local.ts` |
| Chrome loads | `.../projects/nanobrowser/dist` (unpacked) | Extension id on this machine: `nnldlldkcjcooleefoflkgcjobimnaol` |

### What each tree is for

- **`scion`**: personal second-dev lab.
  Layout: `projects/<name>/` (code snapshot) + `reports/<name>/` (E2E + decisions).
  Source for personal Nanobrowser changes is under `projects/nanobrowser/`.
  No `node_modules` / `dist` / secrets in git (see root `.gitignore`).

- **`~/projects/nanobrowser`**: the tree you **build and load into Chrome**.
  Remote is still **upstream** `https://github.com/nanobrowser/nanobrowser.git` (branch `master`).
  Personal changes are mostly **uncommitted** relative to that upstream remote.
  Source for key personal files was verified **byte-identical** to `scion/projects/nanobrowser` on 2026-07-13 (except gitignored secrets).

### Recommended workflow for Codex

1. **Edit and build in** `~/projects/nanobrowser` when changing runtime behavior.
2. After a coherent change set, **sync the same files into** `scion/projects/nanobrowser` (rsync or copy of tracked paths only).
3. Write / update notes under `scion/reports/nanobrowser/`.
4. Commit + push **only** from `scion` to `origin` (`yishu-ziyu/scion`).
5. Do **not** force-push personal secrets or point upstream Nanobrowser `origin` at scion without an explicit owner decision.

Optional later cleanup (not done yet):

- Add `git remote add personal git@github.com:yishu-ziyu/scion.git` is wrong for the nested app; keep app history separate or vendor as monorepo only.
- Or relocate active build tree next to scion and symlink `~/projects/nanobrowser`.

---

## 3. Name and identity

- Lab name: **scion** (接穗 = grafted shoot; upstream is rootstock).
- Old name: `oss-forks` (retired; symlink remains).
- Maintainer GitHub: `yishu-ziyu`.

---

## 4. What already works (do not re-break)

### Product

- Chinese UI default (`zh_CN` as `default_locale` + locale packs).
- Personal bootstrap injects MiniMax provider + Planner/Navigator agent models into `chrome.storage` on extension start.
- API key comes from build-time inject, not Options GUI typing.
- MiniMax-M3 via OpenAI-compatible endpoint `https://api.minimaxi.com/v1`, provider id `minimax`, type `custom_openai`.

### Reliability fixes (MiniMax)

Mid models often emit:

```text
<think>...reasoning...</think>
{ "action": [...] }
```

LangChain `withStructuredOutput` then fails with `Unexpected token '<'`.

Personal fork changes:

1. **Disable structured output** for MiniMax / custom_openai-like providers in agent base class.
2. **Strip think tags** (including unclosed) before JSON parse.
3. **Manual JSON extraction**: fenced ```json```, brace matching, fallbacks.
4. **Action schema coercion**: camelCase aliases → snake_case; string numbers → numbers for `index` / `tab_id`.
5. **Planner schema defaults** when model omits fields.
6. **Executor** passes `navigatorProviderId` / `plannerProviderId` into agents so provider-aware logic actually runs.

### E2E (main Chrome CDP 9222)

| Case | Result | Evidence (local) |
|------|--------|------------------|
| Simple Planner: Chinese one-liner about example.com | PASS | `/tmp/nanobrowser-e2e-main/` |
| Multi-step Navigator: example.com → "More information" → IANA page Chinese summary | PASS (retries absorbed mid-parse fails) | `/tmp/nanobrowser-e2e-nav5/` |
| Visual after dist reload | PASS (Chinese side panel; storage shows MiniMax-M3) | `/tmp/nanobrowser-visual/` |

Detail report: `reports/nanobrowser/2026-07-13-minimax-e2e-cdp.md`.

---

## 5. Architecture of the personal layer

```text
chrome-extension/src/personal/
  config.ts                 # provider id, baseUrl, model names, agent params
  bootstrap.ts              # ensurePersonalDefaults() → chrome.storage
  secrets.local.example.ts  # template
  secrets.local.ts          # GITIGNORED real key (build output)

chrome-extension/scripts/
  inject-personal-secrets.mjs   # writes secrets.local.ts from env files

chrome-extension/src/background/index.ts
  → calls ensurePersonalDefaults() early
  → createChatModel(...) + executor with provider ids

chrome-extension/src/background/agent/
  agents/base.ts            # structured-output gate; parse path; debug previews
  messages/utils.ts         # removeThinkTags + extract JSON helpers
  actions/schemas.ts        # coerce / aliases
  executor.ts               # wires provider ids into agents
  agents/planner.ts         # defaults for omitted planner fields
  types.ts                  # extra args types
```

### Bootstrap policy (intentional)

`ensurePersonalDefaults()` **overwrites** non-minimax providers and force-writes Planner/Navigator to MiniMax-M3.

This is a **self-use fork**, not a multi-user product setting.

If Codex adds a second provider (e.g. StepFun), change `config.ts` + bootstrap carefully so multi-provider inventory is explicit, not "whatever was last in GUI".

### Secrets inject sources (in order, merged)

Script: `pnpm inject:personal` → `chrome-extension/scripts/inject-personal-secrets.mjs`

Looks for `MINIMAX_API_KEY` or `MINIMAX_TOKEN_PLAN_KEY` in:

1. `~/.config/ai-providers/env.local`
2. `~/.config/ai-providers/.env`
3. repo `/.env.local` (two relative candidates)
4. process env (wins)

Never print the full key.
Never commit `secrets.local.ts`.

Build always runs inject first:

```json
"build": "pnpm inject:personal && pnpm clean:bundle && turbo ready && turbo build"
```

---

## 6. File change map (relative to upstream Nanobrowser)

Upstream base around: `nanobrowser/nanobrowser` v0.1.13 / commit near `322384f`.

### New (untracked on daily tree vs upstream)

- `chrome-extension/src/personal/**`
- `chrome-extension/scripts/inject-personal-secrets.mjs`
- `packages/i18n/locales/zh_CN/**`

### Modified (daily tree `git status` snapshot 2026-07-13)

- `.gitignore` (ignore secrets)
- `package.json` (`inject:personal`, build/dev hooks)
- `chrome-extension/manifest.js` (`default_locale: zh_CN`)
- `chrome-extension/src/background/index.ts`
- `chrome-extension/src/background/agent/agents/base.ts`
- `chrome-extension/src/background/agent/agents/planner.ts`
- `chrome-extension/src/background/agent/executor.ts`
- `chrome-extension/src/background/agent/messages/utils.ts`
- `chrome-extension/src/background/agent/actions/schemas.ts`
- `chrome-extension/src/background/agent/types.ts`
- `packages/i18n/lib/getMessageFromLocale.ts`
- `packages/i18n/lib/type.ts`
- `packages/i18n/locales/en|pt_BR|zh_TW/messages.json` (as needed for type intersection)
- `pages/options/src/Options.tsx`
- `pages/side-panel/src/SidePanel.tsx`
- `pages/side-panel/src/components/ChatInput.tsx`
- `pages/side-panel/src/components/MessageList.tsx`

When syncing into scion, copy these paths (not `node_modules`, not `dist`, not `secrets.local.ts`).

---

## 7. Build / reload / verify (local)

### Prerequisites

- Node + pnpm (project uses workspace + turbo; see `.nvmrc` if present)
- MiniMax key present in one of the inject source files
- Google Chrome as daily browser

### Build

```bash
cd /Users/mahaoxuan/projects/nanobrowser
pnpm install          # first time or lockfile change
pnpm build            # inject secrets → clean dist → turbo build
```

### Load extension

Chrome → Extensions → Developer mode → Load unpacked →

```text
/Users/mahaoxuan/projects/nanobrowser/dist
```

After rebuild: **Reload** the extension card, then reopen the **side panel** (not as a normal tab if testing navigation).

### CDP on main Chrome (long-term ops)

Tool: `~/bin/chrome-cdp`

```bash
~/bin/chrome-cdp status
~/bin/chrome-cdp ensure    # preferred: repair only if unhealthy
~/bin/chrome-cdp repair    # force quit main Chrome + relaunch with flags
```

Flags required when something is wrong:

- `--remote-debugging-port=9222`
- `--remote-allow-origins=*`
- **same default user-data-dir** (main profile)

Failure mode already seen: process lists `--remote-debugging-port=9222` but nothing listens / `DevToolsActivePort` stale → `ensure` or `repair`.

**Hard rule:** drive **main** Chrome (extensions + login).  
Do **not** use empty `/tmp` profiles for Nanobrowser product E2E.  
Deprecated: `~/bin/chrome-debug-launcher.sh` redirects to `chrome-cdp ensure`.

Other profiles on this machine (do not confuse):

- browseract headless profiles
- `~/.chrome-agent-debug-profile` (often 9223)
- throwaway `/tmp/chrome-debug-9222`

### Smoke checklist after a change

1. `pnpm build` succeeds.
2. Extension reloads without service worker crash.
3. Side panel UI is Chinese.
4. Storage shows Planner/Navigator → MiniMax-M3, base `https://api.minimaxi.com/v1` (check via extension options / debug logs).
5. Task on a content tab: "用一句话中文总结当前页面" on example.com → final Chinese answer, no 401, no raw `<think>` in UI.
6. Optional harder: multi-step click path to IANA (see report).

---

## 8. Testing pitfalls (learned the hard way)

1. **Side panel as a normal tab**  
   If the chat UI is focused as a tab, Navigator may treat it as the active page and navigate *away* from the task context.  
   Daily use: real Chrome **side panel**; keep the **content tab** active for navigation tasks.

2. **401 after key rotate**  
   Force rebuild with inject (`pnpm build`) so bootstrap writes the new key. Old keys in storage get overwritten by bootstrap when key is non-empty.

3. **Intermediate JSON parse errors**  
   MiniMax still occasionally returns non-extractable payloads on long Navigator prompts. Retries often recover. Do not call the product "done" for strict 0-fail until a regression suite proves it.

4. **CDP != human side panel**  
   Automations that open `chrome-extension://.../side-panel/index.html` as a page are not equivalent to `chrome.sidePanel` UX.

5. **Unpacked path drift**  
   Chrome remembers the unpacked folder. If you build only under scion without copying to the path Chrome loads, you will test stale code.

---

## 9. Open risks / unfinished work

Priority suggestions for Codex (owner can reorder):

### P0 - do not lose

- Keep secrets out of git.
- Keep main-Chrome CDP path working.
- After code edits, verify with real side panel + content tab, not only unit lint.

### P1 - quality

1. **Strict multi-step regression** targeting 0 intermediate parse failures on a fixed task set.
2. **DONE 2026-07-13:** exclude `chrome-extension://` tabs from Navigator state and close selection, attachment, update-invalidation, and blank→HTTP races. See the dated report.
3. Harden JSON extraction further (partial JSON, tool-call wrappers, Chinese prose + trailing JSON).
4. Capture failing raw model payloads to a local debug sink (already partial in base agent) and document how to read them.

### P2 - product pack

1. Optional second provider in personal inventory (e.g. StepFun) without breaking MiniMax default.
2. Decision: keep bootstrap force-overwrite vs "seed once then respect GUI".
3. Align remotes: either document dual-tree forever, or co-locate active tree under `AI产品经理/自研产品` + symlink.

### P3 - upstream hygiene

1. Rebase/merge strategy vs `nanobrowser/nanobrowser` (personal/bootstrap + parse path will conflict).
2. Consider splitting pure upstream-contributable parse fixes vs personal bootstrap (if ever contributing back).

---

## 10. Constraints / do-nots

- Do **not** commit API keys, `secrets.local.ts`, or `.env*` with secrets.
- Do **not** manually edit auto-generated `CHANGELOG.md` if upstream marks it generated.
- Do **not** test Nanobrowser product claims on empty debug profiles.
- Do **not** kill unrelated user Chrome sessions without saying so; `chrome-cdp repair` **does** quit main Chrome - warn the user first if they have unsaved work.
- Do **not** rename GitHub `scion` or move Desktop path without updating this HANDOVER + README.
- Prefer small reversible commits on `scion`.
- Agent durable docs: English OK; user chat: Chinese default.

---

## 11. How to sync daily tree → scion (after coding)

Example (adjust excludes as needed):

```bash
DAILY=/Users/mahaoxuan/projects/nanobrowser
SCION=/Users/mahaoxuan/Desktop/AI产品经理/自研产品/scion/projects/nanobrowser

rsync -a \
  --exclude node_modules --exclude dist --exclude dist-zip \
  --exclude .turbo --exclude coverage \
  --exclude secrets.local.ts --exclude .env --exclude .env.local \
  "$DAILY/" "$SCION/"

# then in scion:
cd /Users/mahaoxuan/Desktop/AI产品经理/自研产品/scion
# write/update reports/nanobrowser/...
git status
git add projects/nanobrowser reports
# commit message in complete sentences; no AI co-author trailer
git push origin main
```

If Codex only works inside the scion checkout, either:

- `pnpm install && pnpm build` under `scion/projects/nanobrowser` and point Chrome Load unpacked at **that** `dist`, or
- keep using daily tree as runtime (preferred today).

---

## 12. Config snapshot (non-secret)

| Item | Value |
|------|--------|
| Model | MiniMax-M3 |
| Provider id | `minimax` |
| Provider type | CustomOpenAI / custom_openai |
| Base URL | `https://api.minimaxi.com/v1` |
| Agents | Planner + Navigator both MiniMax-M3 |
| Planner params | temperature 0.3, topP 0.6 |
| Navigator params | temperature 0.2, topP 0.5 |
| Default locale | `zh_CN` |
| Unpacked id (this machine) | `nnldlldkcjcooleefoflkgcjobimnaol` |
| CDP port | `9222` |
| Upstream | https://github.com/nanobrowser/nanobrowser |
| Lab remote | https://github.com/yishu-ziyu/scion |

---

## 13. Related docs

| Doc | Purpose |
|-----|---------|
| [README.md](./README.md) | scion lab overview + local path |
| [reports/nanobrowser/README.md](./reports/nanobrowser/README.md) | report index |
| [reports/nanobrowser/2026-07-13-minimax-e2e-cdp.md](./reports/nanobrowser/2026-07-13-minimax-e2e-cdp.md) | E2E detail + open risks |
| `~/bin/chrome-cdp` | main Chrome CDP ensure/repair |
| Upstream `projects/nanobrowser/CLAUDE.md` / `README.md` | original project conventions |

---

## 14. Suggested first Codex session plan

1. Open this HANDOVER + the E2E report.
2. `cd ~/projects/nanobrowser && git status` and confirm personal files present.
3. `~/bin/chrome-cdp status` and `pnpm build` if dist is stale.
4. Pick **one** P1 item (recommend: exclude `chrome-extension://` tabs from Navigator target selection, or harden parse with a fixture-based unit test).
5. Implement with small diff; rebuild; human-like E2E on main Chrome side panel.
6. Sync sources into scion; append a dated note under `reports/nanobrowser/`; commit; push.

Done criteria for a Codex handoff chunk:

- Code change has a clear product sentence in the report.
- Build green.
- At least one real browser task verified (or explicit reason if skipped).
- Secrets still gitignored.
- scion `main` updated if the change should persist beyond this machine's daily tree.

### Section 14 closure (2026-07-13)

- Completed the recommended extension-tab isolation item through a full design → TDD → independent-review cycle.
- `BrowserContext` now owns committed target acquisition, attachment-result checking, post-attachment refetch, current-selection commit, and forbidden-update invalidation as one safety boundary.
- Pending-only HTTP targets wait for commit. `about:blank` remains the sole unattached navigation bootstrap and is rebuilt/attached if it becomes HTTP, including during the same acquisition.
- Verification: BrowserContext **18/18**, full chrome-extension suite **32/32**, targeted ESLint **PASS**, production build **PASS**, final narrow peer verification **PASS**.
- The only type-check failure remains the unrelated `agent/helper.ts:24` `completionWithRetry` mismatch. Real side-panel E2E remains explicitly skipped because approved browser control could not enumerate native Chrome UI and prohibited direct extension-URL automation; no unsafe workaround was used.
- Daily runtime and scion copies of the three changed runtime files were verified identical. The next session can begin product intake/design for the larger second-development program instead of reopening this blocker.

### Second-development design closure (2026-07-13)

- Completed product intake, architecture, and `/yishuship:design` for the larger action-Agent cycle. This stage changed design/control documents only; it did not implement the new runtime.
- The product boundary is now explicit: one durable browser task, contextual follow-up, approval before external commits, evidence-gated completion, generic HTML media control, and local semantic Skills. Old raw action replay is removed rather than evolved.
- The executable plan is split into seven tracer-bullet stories and passed an independent execution drill after closing lifecycle, ACK/revision, approval consumption, completion-proof, media-target, Skill-input/privacy, and real-Chrome orchestration blockers.
- Canonical architecture: `TaskManager` owns one task state machine; every action passes through `ActionDispatcher`; `CompletionChecker` is the only completion authority; normal raw instructions remain only in user-authored chat; resolved Skill values remain memory-only.
- Design artifacts: `.ship/tasks/plan-large-nanobrowser-second-development/plan/{spec.md,peer-spec.md,diff-report.md,plan.md,drill-report.md}` and `docs/design/001-browser-action-task-runtime.md`.
- Next session should enter `/yishuship:dev` and execute Story 1 first. Do not skip directly to Skills or real-site acceptance; later stories depend on the replay-removal and durable-lifecycle seams.

---

## 15. Contact / ownership notes

- This is a **personal fork**, not a multi-tenant product build.
- Quality bar: human-like E2E on the real browser beats green unit tests alone.
- When stuck on anti-bot or empty browser issues: re-read section 7 (CDP) and section 8 (pitfalls) before inventing new launchers.
