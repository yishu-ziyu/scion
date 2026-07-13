# Nanobrowser 二开：MiniMax-M3 + 主 Chrome E2E（2026-07-13）

## Goal

Make a personal Nanobrowser fork usable with MiniMax Token Plan (`MiniMax-M3`) without GUI key entry, and verify with human-like browser E2E on the **main** Chrome profile (not a throwaway empty profile).

## What we changed (code)

Under `projects/nanobrowser`:

- **zh_CN** i18n + default locale force Chinese UI
- **personal bootstrap** (`chrome-extension/src/personal/`): inject MiniMax provider + Planner/Navigator agents at runtime
- **secrets**: `secrets.local.ts` gitignored; build inject script
- **MiniMax structured output off**: mid models emit `<think>...`; manual JSON extraction instead
- **JSON robustness**:
  - strip `<think>` / unclosed think
  - fenced ```json``` + brace matching
  - camelCase action aliases → snake_case
  - coerce string numbers (`index`, `tab_id`)
  - planner schema defaults for omitted fields
- **Executor** passes `navigatorProviderId` / `plannerProviderId` into agents

## Infra (long-term)

Problem: process shows `--remote-debugging-port=9222` but nothing listens.

Fix tool: `~/bin/chrome-cdp`

```bash
~/bin/chrome-cdp status
~/bin/chrome-cdp ensure   # preferred
~/bin/chrome-cdp repair   # force restart main Chrome with flags
```

Rule: drive **main** Chrome (extensions + login). Do not test Nanobrowser in empty `/tmp` profiles.

Deprecated: `~/bin/chrome-debug-launcher.sh` now redirects to `chrome-cdp ensure`.

## E2E results

### A. Simple Planner task (example.com summary)

- Environment: main Chrome CDP `9222`, extension unpacked from `dist`
- Task: one-sentence Chinese summary of example.com
- Result: **PASS**
- Planner reply (example): page title Example Domain; domain for documentation examples only
- No 401 / no `<think>` leak / no JSON parse error in UI
- Evidence (local machine): `/tmp/nanobrowser-e2e-main/`

### B. Multi-step Navigator (example.com → More information → IANA)

- Task: open/confirm example.com → click More information → Chinese summary of destination
- Result: **PASS** (reached `https://www.iana.org/help/example-domains`, final Chinese answer)
- Intermediate flaky: occasional `Could not manually extract JSON from model output` from MiniMax; retries recovered
- **Test pitfall**: if side panel is opened as a normal tab and kept focused, Navigator may navigate the chat tab away. Daily use should open the real Chrome **side panel**; keep content tab active.
- Evidence (local machine): `/tmp/nanobrowser-e2e-nav5/`

### C. Visual check after dist reload

- Side panel Chinese UI OK
- Storage: Planner/Navigator → MiniMax-M3, base `https://api.minimaxi.com/v1`
- Screenshots: `/tmp/nanobrowser-visual/`

## Config snapshot (non-secret)

| Item | Value |
|------|--------|
| Model | MiniMax-M3 |
| Provider id | minimax |
| Type | custom_openai |
| Base URL | https://api.minimaxi.com/v1 |
| Agents | planner + navigator both MiniMax-M3 |
| Unpacked path | .../projects/nanobrowser/dist |

## Open risks

1. MiniMax still occasionally returns non-JSON or hard-to-extract payloads under long navigator prompts.
2. Side-panel-as-tab testing is not equivalent to real `sidePanel` UX.
3. Upstream merge will need care (personal/bootstrap, i18n, base agent parsing).

## Next ideas

- Strict regression: multi-step with 0 parse failures
- Exclude `chrome-extension://` tabs from Navigator browser state
- Optional second provider (StepFun) in personal package inventory

## Follow-up: extension-tab isolation (2026-07-13)

Product result: the original mixed committed/pending URL leaks are closed locally, but the story remains **BLOCKED in peer review** on attach-time races and has not been pushed.

- `BrowserContext` now reuses the existing URL/firewall policy in three places: cold target selection, the tab inventory sent to agents, and `switch_tab` validation. It checks `pendingUrl` before the last committed `url`, closing the in-flight navigation gap found in peer review.
- Added nine BrowserContext regressions covering active-tab fallback, inventory filtering, mixed committed/pending URLs, already-current tab revalidation, and pre/post-activation rejection.
- Verification: extension tests **23/23 PASS**; targeted ESLint **PASS**; production `pnpm build` **PASS**.
- Fresh-cycle commits: `0d28641` gates tabs on both effective and committed URLs; `b8327a1` revalidates already-current targets; `641b4ca` rechecks a tab after activation before attachment.
- Peer review still ended **FAIL** after two targeted fix rounds. Remaining findings: cold selection and `switchTab()` still have a time-of-check/time-of-use window between their final Chrome snapshot and asynchronous attachment; a pending-only HTTPS tab is approved but `_getOrCreatePage()` constructs `Page` from empty `tab.url`, so it is non-attachable.
- Required next cycle: make validated target acquisition + attachment one owned operation, including post-attach revalidation/detach, and decide whether pending-only tabs wait for commit or construct from the approved effective URL. This is wider than another caller guard and should be settled before the planned larger second-development program.
- Main Chrome CDP health **PASS** (34 targets). Real side-panel E2E was not rerun: native Chrome UI enumeration timed out, then the browser-control safety policy blocked extension-internal URLs and explicitly prohibited a workaround. Manual closure remains: reload the Nanobrowser card, open the real side panel on `example.com`, and run `用一句话中文总结当前页面`.
- Existing unrelated gate: extension type-check still fails at `agent/helper.ts:24` because `completionWithRetry` is absent from the installed `ChatOpenAI` type.
- Known ceiling: when an extension page is active, fallback picks the first allowed tab in tab order. Track the last allowed activation if multi-tab precision becomes necessary.

Parser investigation was deliberately kept separate. The captured MiniMax failure is complete pseudo-XML (`<tool_call><invoke name="AgentOutput">...` with MiniMax delimiters), not malformed JSON. A correct follow-up needs an exact fixture and a direct XML-parser dependency; `jsonrepair` cannot handle this payload. The older E2E `result.json` also marks `no_parse_fail: true` despite parse-failure lines, so that assertion must be fixed before claiming strict zero-failure regression.
