# Shared product language

## Browser action agent

An Agent that operates browser pages until a user goal reaches a verifiable outcome. It is not a page-opening shortcut or a sidebar chatbot.

## Task

A user goal plus its browser context, action history, current tabs/objects, approval state, and completion condition.

## Continuous control

A follow-up instruction such as “pause it” or “continue the form” that resolves against the same task and browser objects instead of starting from an unrelated blank context.

## Verified completion

Observable browser evidence that the requested outcome occurred, such as a submitted-form success state or a video entering the paused state. A model saying `done` is not sufficient by itself.

## Skill

A reusable semantic task recipe with inputs, expected outcome, and approval policy. The first implementation cycle includes local Skill saving and rerun, but excludes sharing and a marketplace. A raw replay of stale element indexes is not a Skill.
