# Feature: Side panel uses 持节 design system (not stock SaaS chrome)

Source of truth: `~/Documents/design-notes/DESIGN.md`

## Background

- No stock sky-blue chrome. Colors come from `--chijie-*` tokens, not a mandatory paper/crayon look.
- No `box-shadow`; hierarchy via surface steps.
- Body: Space Grotesk; labels: Space Mono ALL CAPS; no sky-blue default chrome
- Primary actions are pill buttons
- Task language is human, not raw enum strings

## Scenario: Live run is a tool log, not a collapsed audit

- Given a task snapshot with status `running`
- When the status card is rendered
- Then the user's original sentence is a sand card with no 目标 label
- And the stream shows what happened (search board / opened page), not 获取页面快照
- And a live cursor and 接管 are visible on the stream
- And the composer shows 跟随, not a second 接管
- And the page overlay says 持节正在操作这个页面

## Scenario: Idle home is a hero plus example rows

- Given models are configured and no live task is running
- When the side panel is idle
- Then the user sees a title, a short hint, and example rows that fill the composer
- And there is no Chat / Claw mode rail

## Scenario: Status card speaks human language

- Given a task snapshot with status `running`
- When the status label is rendered
- Then the user sees "进行中" / localized human copy, not the string `running`

## Scenario: Failed task is the original sentence + one verdict + 再说一次

- Given a task snapshot with status `failed`
- When the status card is rendered
- Then there is no 失败了 pill and no rating form
- And the verdict is one human sentence
- And the primary action is 再说一次
- And there is no 目标 / 现在 / 结果 / 做过 label

## Scenario: Completion is plain language, not a receipt id

- Given a completed round with a receipt
- When the completion block is rendered
- Then the visible text is the delivered sentence
- And the visible text does not contain `receipt:`
- And there is no rating form and no receipt details
- And opened pages or search hits appear under the answer as 对核 sources

## Scenario: Thinking follows what already happened

- Given a running task that has already opened a page
- When the work stream is derived
- Then 思考过程 comes after the page card, not above it

## Scenario: High-risk click is previewed

- Given a live `external_commit` click
- When the work stream is derived
- Then the user sees 下一步要提交或确认 and the action title

## Scenario: Skill template helper still replaces field tokens

- Given the last user instruction contains `FIELD_SENTINEL_8472`
- When `instructionToSkillTemplate` runs
- Then it replaces that token with `{{name}}`
- And the completed card does not show 保存为可再运行

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
