# Feature: Side panel uses 奕枢 design system (not stock SaaS chrome)

Source of truth: `~/Documents/design-notes/DESIGN.md`

## Background

- Black ambient canvas (`#000000`), warm paper cards (`#F2E3CF`), crayon accent (`#e35342`)
- No `box-shadow`; hierarchy via surface steps and paper vs black
- Body: Space Grotesk; labels: Space Mono ALL CAPS; no sky-blue default chrome
- Primary actions are pill buttons
- Task language is human, not raw enum strings

## Scenario: Status card speaks human language

- Given a task snapshot with status `running`
- When the status label is rendered
- Then the user sees "进行中" / localized human copy, not the string `running`

## Scenario: Completion is plain language, not a receipt id

- Given a completed round with a receipt
- When the completion block is rendered
- Then the visible text contains a done title/body
- And the visible text does not contain `receipt:`

## Scenario: Waiting for approval is the primary focus

- Given status `waiting_approval` with a pending approval
- When the card is rendered
- Then primary CTA is "同意并继续" (or locale equivalent)
- And actions stack vertically (column layout)

## Scenario: Skill template prefilled from last goal

- Given the last user instruction contains `FIELD_SENTINEL_8472`
- When opening save-as-template
- Then the template prefill replaces that token with `{{name}}`

## Scenario: Design tokens are the only color source for the shell

- Given the side panel stylesheet
- Then CSS custom properties include `--yishu-background`, `--yishu-paper`, `--yishu-accent`, `--yishu-surface`, `--yishu-foreground`
- And TaskStatusCard root uses `yishu-paper-card` (not sky/emerald utility stacks as the only style)

## Scenario: No drop shadows on task chrome

- Given yishu component styles
- Then task card / primary button styles do not set `box-shadow`
