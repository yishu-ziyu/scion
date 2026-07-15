# Spec: Tabbit-class agent task loop (持节 extension MVP)

**Status:** approved for tickets · seams S1–S5 accepted (Owner: go to-tickets immediately)  
**Task:** `tabbit-class-product`  
**Date:** 2026-07-15  
**Upstream:** Matt `/to-spec` after `/grill-with-docs` confirmation  
**Glossary:** `CONTEXT.md` · North star: `docs/product/003-north-star.md`  
**ADRs:** `001` keep Chrome extension · `002` quality-first replaceable core  

---

## Problem Statement

The user wants a **personal browser action agent** that feels like **Tabbit task mode**: they type a natural-language goal in a side panel, the **real Chrome page** changes, they see **human-readable steps**, and the run **ends only with observable evidence** (optional success / partial / fail feedback).  

Today 持节 has extension shell, MiniMax personal bootstrap, a replaceable `control` execution core (G6), and product terms for Task / approval / verified completion — but the **user-visible loop** still drifts toward engineer noise (internal roles, opaque failures) and does not reliably present the Tabbit-class “said it → page moved → steps → done” experience. Harder journeys (Feishu with approval, Bilibili pause binding) cannot be trusted until that loop is the single spine.

## Solution

Ship the **agent task loop** as the sole primary product path inside the **existing Chrome extension** on the user’s daily Chrome:

1. **Task mode** in the side panel (not casual chat as the primary path).
2. An in-extension **TypeScript execution core** with two layers:
   - **Agent loop:** observe page → state summary to model → choose action → execute → re-observe; tools; retries (browser-use *architecture*, not the Python package).
   - **Browser control:** `chrome.tabs` / `scripting` / `debugger` (and event-style watchdogs for navigation, dialogs, downloads).
3. **Human-readable execution steps** and **verified completion** (green check / receipt); optional user rating.
4. **Approval only for external commits**; navigate / read / reversible media need no gate.
5. **Delivery order:** Slice A “open YouTube” minimum green → same core Slice B Feishu+approval and/or Slice C Bilibili pause.
6. Default / official scoring model: **MiniMax-M3**.

## User Stories

1. As a daily Chrome user, I want task mode in the side panel, so that I can delegate browser work without leaving my logged-in browser.
2. As a user, I want to type “打开 YouTube” (or equivalent), so that the main window actually opens YouTube without me clicking around.
3. As a user, I want human-readable execution steps, so that I can see what the agent is doing without Planner/Navigator/JSON jargon.
4. As a user, I want a clear done state only when the page shows the outcome, so that I am not lied to by a model saying “done”.
5. As a user, I want optional success / partial / fail feedback after a run, so that product quality can improve without engineering logs.
6. As a user, I want navigate and read actions to run without approval prompts, so that simple tasks stay fast.
7. As a user, I want form submit / send / purchase-style actions to stop for one-use approval, so that irreversible outcomes stay under my control.
8. As a user, I want zero unapproved external commits, so that the agent never ships a message or form without me.
9. As a user, I want failures explained in plain categories (login wall, miss target, false complete, etc.), so that I know what to do next.
10. As a user, I want the agent to retry recoverable step failures, so that flaky mid-model output does not kill the whole task.
11. As a user, I want follow-up instructions on the same task (continuous control), so that “pause this” binds the right tab/media.
12. As a user, I want Feishu form fill → approve → single submit → success evidence, so that work tools are usable.
13. As a user, I want Bilibili (or similar) play then “pause this” verified, so that media control feels continuous.
14. As a user, I want MiniMax-M3 as the default agent model for real scores, so that quality is not fake-flagship only.
15. As a user, I do not want to install a separate Python agent to use the product daily, so that the extension alone is enough.
16. As a user, I do not want a full custom browser reinstall this cycle, so that I keep Chrome + existing logins.
17. As a user, I do not want 妙招广场, desktop pet, or multi-model shelf UI this cycle, so that the team finishes the task loop first.
18. As a future user, I want cross-conversation memory later, so that the product remembers preferences across sessions (not this cycle).
19. As an owner running acceptance, I want a fixed Slice A protocol with pass/fail, so that green is objective.
20. As an owner, I want Slice B/C on the **same** core as Slice A, so that we do not fork product lines.
21. As a developer, I want a replaceable execution core behind a stable Task contract, so that core swaps do not rewrite the side panel.
22. As a developer, I want tests at Task / completion / control-loop seams, so that regressions are caught without full Chrome every time.
23. As a privacy-conscious user, I want storage free of full form values and credentials in non-chat logs, so that G7 direction is respected as we build.
24. As a user, I want the side panel to show goal, status, next step, and outcome — not internal agent role names.
25. As a user, I want the agent to observe the real tab state before each action, so that actions match the page I see.
26. As a user, I want downloads/dialogs/navigation glitches handled without silent stall, so that long tasks do not die invisibly.
27. As an owner, I want reports under `reports/nanobrowser/` for verified runs, so that claims stay auditable.
28. As a user, I want to continue a task after interrupt (extension reload), so that work is not always lost (best-effort; exact durability may phase).
29. As a user, I want Chinese UI for the task surface, so that daily use matches locale.
30. As an owner comparing to Tabbit, I want the same *class* of experience (task → act → steps → done), not feature parity with Tabbit’s full browser product.

## Implementation Decisions

1. **Shell:** Chrome MV3 extension + side panel task mode on daily Chrome (ADR 001 stands). No full Chromium product this cycle.
2. **Core:** Two-layer in-extension TS core (agent loop + browser control). Strengthen / reshape existing `control` backend and Task path rather than defaulting to a Python browser-use process.
3. **Architecture inspiration:** browser-use loop semantics (observe → summarize → act → re-observe, tools, retry). Explicit non-goal: embed the browser-use Python package in the service worker.
4. **Product contract remains authority:** Task, Task Round, external commit, verified completion, completion receipt (see CONTEXT.md).
5. **Approval policy:** gate only actions classified as external commit; read/navigate/reversible media free.
6. **UI contract:** task mode input; collapsible human-readable steps; done with evidence; optional rating controls. No Planner/Navigator/`step_failed` as primary user language.
7. **Model:** MiniMax-M3 default for official acceptance runs (G5).
8. **Slice order:** A (YouTube open) → B (Feishu + approval) and/or C (media pause binding) on the same core.
9. **Reuse existing modules where they already implement contract:** TaskManager, ActionDispatcher, CompletionChecker, control-loop / control-policy, BrowserContext — extend rather than parallel ghost systems.
10. **Watchdogs:** navigation / dialog / download (and similar) as event-style handlers in browser control layer, not only “poll on next LLM turn”.
11. **Privacy:** do not persist full form field values, passwords, or page body into non-chat durable storage for debug by default.
12. **Later intent only:** cross-conversation memory — design hooks may be noted; no implementation commitment this cycle.

## Testing Decisions

### What good tests are

- Assert **external behavior** of the agent task loop and product contract (page-facing outcomes, approval gates, step visibility contracts, completion only with evidence flags).
- Do **not** lock tests to internal LLM prompt wording or private helper names unless they are the public seam.
- Prefer few high seams over many micro-mocks.

### Test seams (accepted)

Prefer **existing** seams; ideal is one primary product seam with thin adapters.

| # | Seam | Level | Use for |
|---|------|-------|---------|
| S1 | **Side panel task UX** (task mode, steps list, done, optional rating) | UI / message contract | Slice A visible loop; no engineer jargon |
| S2 | **TaskManager + ActionDispatcher + CompletionChecker** | Product contract | lifecycle, external commit gate, verified completion |
| S3 | **Control agent loop** (observe → decide → act → re-observe; parse/retry) | Execution core | mid-model JSON, retries, done policy |
| S4 | **BrowserContext / page observe+act** | Browser control | navigation, isolation of extension tabs, media helpers |
| S5 | **Main Chrome E2E (CDP 9222)** | Full system | Slice A YouTube protocol; later B/C with Owner login |

**Primary seam for most unit/integration tests:** S2 (product contract).  
**Primary seam for “does it feel like Tabbit”:** S1 + S5.  
**Avoid new parallel task systems** that bypass S2.

### Prior art in repo

- `chrome-extension/.../task/__tests__/*` (manager, completion, form/media journeys, control-backend-journey)
- `chrome-extension/.../agent/backends/__tests__/*` (control-loop, control-policy)
- `chrome-extension/.../browser/__tests__/*` (context, media)
- `pages/side-panel/src/design/__tests__/ui-acceptance.test.ts`
- Reports / bakeoff matrices under `reports/nanobrowser/`

### Slice A acceptance protocol (product)

- Model: MiniMax-M3  
- Instruction class: open YouTube (Chinese or English equivalent)  
- Pass: YouTube main surface loaded in a content tab; steps human-readable; UI shows verified done; no false complete if load failed  
- Evidence: short report under `reports/nanobrowser/`  

## Out of Scope

- Full custom browser (Tabbit app shell)
- Skill marketplace / 妙招广场
- Cross-conversation memory (later intent only)
- Desktop pet
- Smart tab grouping as a pillar
- Multi-model shelf UI as a pillar
- Default production path via Python browser-use sidecar
- Claiming Tabbit internal benchmark reproduction (G8 rules still apply when scoring real sites)
- Local Skill save/rerun as a **required** deliverable of this MVP cycle (may exist in code; not the acceptance gate for Slice A)

## Further Notes

- North star long-term still includes G3/G4 ≥91.8% and G8 alignment table; this spec’s **first green** is Slice A loop quality, then B/C on the same core.
- ADR 001 remains; if extension lifecycle later blocks success rates, re-open carrier with evidence (already allowed in ADR 001 consequences).
- ADR 002 still allows core replacement if the TS loop cannot hit quality; replacement must still expose S2 contract.
- Matt path next: confirm seams S1–S5 → `/to-tickets` vertical slices with blocking edges → `/implement` + `/tdd` per ticket.

---

## Seam confirmation (Owner)

Please reply **seams OK** or list changes to S1–S5.  
No implement until seams accepted and tickets cut.
