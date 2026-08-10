# Shared product language

> **Current north star:** long-horizon task Agent in the user's Chrome (`docs/product/021`).
> **Current execution policy:** task-scoped autonomy (`docs/decisions/004`).
> Old “browser action demo + step approval + Claw 30 parity” language is **historical** only.

## Long-horizon task Agent

An Agent that accepts a natural-language goal, maintains a mission/plan, operates the browser across pages and stages, and delivers a **verifiable** outcome. It is not a page-opening shortcut, a sidebar chatbot, or a single-action demo product.

## Task

A user goal plus browser context, action history, current tabs/objects, risk/audit labels, and completion condition.

## Task Round

One instruction within a Task. A follow-up creates a new round with its own actions, evidence, and immutable completion receipt without rewriting earlier outcomes.

## Continuous control

A follow-up instruction such as “pause it” or “continue the form” that resolves against the same task and browser objects instead of starting from an unrelated blank context.

## Verified completion

Observable browser evidence that the requested outcome occurred. A model saying `done` is not sufficient by itself.

## Completion receipt

An immutable summary of one Task Round's outcome, observable evidence, external-commit labels, browser target, and completion time.

## External commit

An action that creates a visible or difficult-to-reverse result outside the Agent (submit, purchase, send, publish, delete, permission change). It is a **risk/audit label**, not a default approval gate.

## Approval policy (current)

- **Task-scoped autonomy:** stating a goal authorizes the actions clearly required by that goal.
- **External commits execute directly** and remain labeled for receipt/audit/privacy redaction.
- **Stop, not approve:** the user can stop or correct at any time; this replaces step-by-step permission popups.
- **Only out-of-scope high-risk actions** need explanation/confirmation; sensitive inputs still reject automatic entry.

Historical docs that still mention `waiting_approval` / submit-before-approve are pre-2026-08-02 records. Runtime may migrate legacy `waiting_approval` snapshots to `interrupted`; that is compatibility, not current UX.

## Skill

A reusable semantic task recipe with inputs, expected outcome, and policy. Local save/rerun is in scope for early cycles; marketplace is not. Replaying stale element indexes is not a Skill.

## Quality first

Correctness, safety, verified completion, privacy, and maintainability beat delivery speed and sunk cost. When quality requires replacing the Agent execution core, replace it (`docs/decisions/002`).

## Agent task loop (core acceptance)

1. User gives a natural-language goal in **task mode**.
2. The main browser surface actually changes (navigate, fill, click, media control, multi-page work).
3. The agent panel shows human-readable execution steps / plan stages.
4. Completion is shown only with observable page evidence (receipt / checkable delivery).
5. Optional user rating: success / partial / failed.

Short browser demos are **instances** of the same loop, not the product identity.

## Capability ceiling A→C (owner 2026-07-23)

Full decision: `docs/decisions/003-a-to-c-capability-ceiling-and-voice.md`.

- **Now = A:** extension-native reliability on the user's real Chrome is the acceptance floor.
- **Direction = C:** deepen toward native-browser-class harness; do not treat “A forever” as success.
- **Means:** companions allowed under the same plugin face; forking Chromium is not default (`decisions/001`).

## Dual voice

- **Engineering / eval / ADRs:** precise terms when they reduce ambiguity.
- **Product UI:** plain language; no Planner/Navigator/`step_failed` leakage on the main task UI.
- Historical Claw-aligned UX notes live under `docs/design/005` and `docs/product/016`–`018` as **historical** references only.

## In scope (current product line)

- Task mode in the extension side panel
- Mission/Plan, long-horizon context handling, interrupt/resume direction per 021/019
- Browser understanding + action + agent loop
- Task-scoped autonomy (decision 004)
- Verified completion + optional feedback
- Eval hooks and matrix runs per 020
- Chrome extension shell on daily Chrome
- Official scoring model: **MiniMax-M3**
- Memory **interface** stub only (stable contract, empty or thin)

## Out of scope this cycle

- Skill marketplace
- Personal knowledge graph as a ship goal
- Full custom browser
- Desktop pet / 桌宠
- Smart tab grouping as a product pillar
- Multi-model “shelf” UI as a product pillar
- Restoring default step-approval as the main product flow

## Historical reference sets (not north star)

- Claw 30 matrix and scorecard: `016` / `017` / `018` — eval/research assets only
- Old parity doctrine: `011` — historical phase language
- Old browser-action north star: `003` — superseded by `021`

## Shell vs core

- **Shell:** Chrome extension on daily Chrome with side-panel task mode.
- **Product contract:** Task, agent loop, task-scoped autonomy, verified completion, receipt, Skill, privacy.
- **Execution core:** default `control` (observe-act); `nano` demotable (`docs/design/002`).
- Browser control via extension APIs; not a Python CDP client inside the service worker as the product path.

## North star

Single end goal: a powerful **long-horizon task agent** plugin that runs in the user's Chrome and delivers verifiable outcomes.
See `docs/product/021-long-horizon-task-agent.md`.
Current milestone is named in that file and in `run_state.yaml` (must agree).

## Docs-driven development

See `docs/README.md` and `docs/product/004-docs-driven-dev.md`.
Conflict order: Owner correction → **021** → **004 decision** → **020** → **019** → `run_state.yaml` → design/* → code.

## Team loop

- Protocol: `docs/product/010-three-loop-g1-g4-protocol.md`
