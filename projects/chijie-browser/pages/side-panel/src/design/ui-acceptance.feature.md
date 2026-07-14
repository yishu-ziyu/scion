# Feature: Side panel uses 持节 design system (not stock SaaS chrome)

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
- Then primary CTA is "批准一次" (or locale equivalent)
- And actions stack vertically (column layout)

## Scenario: Skill template prefilled from last goal

- Given the last user instruction contains `FIELD_SENTINEL_8472`
- When opening save-as-template
- Then the template prefill replaces that token with `{{name}}`

## Scenario: Design tokens are the only color source for the shell

- Given the side panel stylesheet
- Then CSS custom properties include `--chijie-background`, `--chijie-paper`, `--chijie-accent`, `--chijie-surface`, `--chijie-foreground`
- And TaskStatusCard root uses `chijie-paper-card` (not sky/emerald utility stacks as the only style)

## Scenario: No drop shadows on task chrome

- Given yishu component styles
- Then task card / primary button styles do not set `box-shadow`

## Scenario: Welcome empty state uses 持节 paper card (not sky chrome)

- Given models are not configured
- When the welcome block is rendered
- Then it uses `chijie-welcome` / `chijie-welcome-card` classes
- And source has no `text-sky-*` / `bg-sky-*` on the welcome block
- And primary CTA uses the pill primary button contract

## Scenario: Options settings page uses 持节 shell (not sky chrome)

- Given the Options page shell and design tokens
- Then Options imports chijie tokens/components
- And layout uses `chijie-options-layout` / `chijie-options-nav` / `chijie-options-main`
- And Options.tsx has no `#0EA5E9` / `bg-sky-*` / sky utility stacks
- And settings surfaces use yishu border/surface tokens (not stock blue toggles as primary chrome)
- And yishu component styles for options do not set `box-shadow`

## Scenario: SidePanel.css has no legacy sky scrollbar/header chrome

- Given SidePanel.css
- Then scrollbar and header icon colors use `--chijie-*` tokens (or paper/accent hex from DESIGN.md)
- And source does not contain `#0ea5e9` / `#19C2FF` / sky-blue palette
