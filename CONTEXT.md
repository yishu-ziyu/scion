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

## Skill

A reusable semantic task recipe with inputs, expected outcome, and approval policy. The first implementation cycle includes local Skill saving and rerun, but excludes sharing and a marketplace. A raw replay of stale element indexes is not a Skill.

## Quality first

Correctness, safety, verified completion, privacy, and maintainability beat delivery speed and sunk cost. When quality requires replacing the Agent execution core, replace it; do not protect "we already built on Nano core."

## Shell vs core

- **Shell**: Chrome extension, side panel, user login state on the daily browser.
- **Product contract**: Task, approval, verified completion, receipt, Skill, privacy boundaries.
- **Execution core**: Planner/Navigator-style action loop. Replaceable. Not a moat.

## North star

Single end goal: `docs/product/003-north-star.md`.
Gates G1–G7 beat intermediate thrash. Current milestone is always named there.

## Docs-driven development

See `docs/README.md` and `docs/product/004-docs-driven-dev.md`.
North star and gates: `docs/product/003-north-star.md`.
