# Shared product language

## Browser action agent

An Agent that operates browser pages until a user goal reaches a verifiable outcome. It is not a page-opening shortcut or a sidebar chatbot.

## Task

A user goal plus its browser context, action history, current tabs/objects, approval state, and completion condition.

## Task Round

One instruction within a Task. A follow-up creates a new round with its own actions, evidence, and immutable completion receipt without rewriting earlier outcomes.

## Continuous control

A follow-up instruction such as “pause it” or “continue the form” that resolves against the same task and browser objects instead of starting from an unrelated blank context.

## Verified completion

Observable browser evidence that the requested outcome occurred, such as a submitted-form success state or a video entering the paused state. A model saying `done` is not sufficient by itself.

## Completion receipt

An immutable summary of one Task Round's outcome, observable evidence, approved external commits, browser target, and completion time.

## External commit

An action that creates a visible or difficult-to-reverse result outside the Agent, such as submitting, purchasing, sending, publishing, deleting, or changing permissions. It requires one-use approval immediately before execution.

## Approval policy (MVP)

- **Read / navigate / fill-in-progress / media control that is reversible:** no approval gate.
- **Actions labeled external commit:** stop and require one-use user approval before execute; zero unapproved external commits.
- Classification is per action (and thus per task mix), not a global “always ask” or “never ask”.

## Skill

A reusable semantic task recipe with inputs, expected outcome, and approval policy. The first implementation cycle includes local Skill saving and rerun, but excludes sharing and a marketplace. A raw replay of stale element indexes is not a Skill.

## Quality first

Correctness, safety, verified completion, privacy, and maintainability beat delivery speed and sunk cost. When quality requires replacing the Agent execution core, replace it; do not protect "we already built on Nano core."

## Agent task loop (MVP acceptance)

The sole primary acceptance for the product MVP:

1. User gives a natural-language goal in **task mode** (not casual chat).
2. The main browser surface actually changes (navigate, fill, click, media control).
3. The agent panel shows human-readable execution steps.
4. Completion is shown only with observable page evidence (green check / receipt).
5. Optional user rating: success / partial / failed.

Reference experience: Tabbit task mode (e.g. “open YouTube” → real YouTube tab + steps + done).

Harder journeys (Feishu submit with approval, Bilibili pause binding) are longer instances of the same loop, not a different product.

## Delivery order (MVP slices)

1. **Slice A (minimum green):** Tabbit-class “open YouTube” — task mode → real navigation → human-readable steps → verified done (optional success/partial/fail feedback).
2. **Same core, next:** Feishu form + external-commit approval (simplified G3) and/or Bilibili pause binding (simplified G4).
3. Not a second product line: one agent loop and shell; only task difficulty grows.

## In scope this cycle (MVP)

- Task mode in the extension side panel
- Human-readable execution steps
- Verified completion (and optional success / partial / fail feedback)
- Chrome extension shell on daily Chrome
- Official scoring / default agent model: **MiniMax-M3** (mid-tier)

## Out of scope this cycle

- Skill marketplace / 妙招广场
- Cross-conversation memory (product intent later; not this cycle)
- Full custom browser (permanent non-goal unless Owner explicitly changes product direction)
- Desktop pet / 桌宠
- Smart tab grouping as a product pillar
- Multi-model “shelf” UI as a product pillar

## Later intent (not scheduled)

- **Cross-conversation memory:** remember user preferences and facts across tasks/sessions so replies stay consistent. Parked after MVP agent task loop is green; do not block slice A–C.

## Shell vs core

- **Shell (final product form):** Chrome extension on the user’s daily Chrome, with a side-panel **task mode** that implements the agent task loop. We benchmark Tabbit's capability and experience, not its native-browser shell.
- **Product contract**: Task, agent task loop, approval, verified completion, receipt, Skill, privacy boundaries.
- **Execution core (decided for MVP):** Two layers inside the extension (TypeScript), inspired by browser-use *architecture*, not the Python package:
  1. **Agent loop** — observe page → state summary to model → choose action → execute → re-observe; tool set; failure retry. This is the product core; reimplemented in the extension.
  2. **Browser control** — drive tabs/pages via extension APIs (`chrome.tabs`, `scripting`, `debugger` / CDP where needed) and event-style watchdogs for navigation, dialogs, downloads. Not a Python CDP client inside the service worker.
- **Out of MVP default:** running stock browser-use as a side Python process (may be a later bake-off path only).

## North star

Single end goal: a powerful Chrome browser-agent plugin benchmarked against Tabbit's capability and experience, not its native-browser shell. The Chrome extension is the final product form. See `docs/product/003-north-star.md` and the living gap ledger `docs/product/009-tabbit-gap-ledger.md`.
Gates G1–G7 beat intermediate thrash. Current milestone is always named there.

## Docs-driven development

See `docs/README.md` and `docs/product/004-docs-driven-dev.md`.
North star and gates: `docs/product/003-north-star.md`.

## Team loop (2026-07-16)

- Protocol: `docs/product/010-three-loop-g1-g4-protocol.md`
- Closed slice: contract `docs/product/dev-contract-010-l1-no-progress-v1.md` → `no_progress` in observe-act-loop; G4 PASS `reports/nanobrowser/2026-07-16-contract-010-l1-no-progress-g4.md`
