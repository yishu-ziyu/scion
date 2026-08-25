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
- And the stream shows what happened (search board / opened page / click line)
- And 获取页面快照 may appear as a quiet action chip in the process, not as a page title
- And a live cursor and 接管 are visible on the stream

## Scenario: Already-open search results grow a board, a reading, and the click

- Given a running task already on a Google `/search` page
- And the observe attempt stored the query plus result titles
- And the control decide stored a human `pageReading`
- And the next act is `click_element` on the fourth result
- When the work stream is derived
- Then the user sees the query and the fourth title
- And the page reading follows those hits
- And the click is its own line with the result title
- And the search board does not treat 获取页面快照 as a query
- And google.com.hk is not drawn twice as both host and title
- And the composer shows 跟随, not a second 接管
- And the page overlay says 持节正在操作这个页面

## Scenario: Idle home is a hero plus example rows

- Given models are configured and no live task is running
- When the side panel is idle
- Then the user sees a title, a short hint, and example rows that fill the composer
- And there is no Chat / Claw mode rail

## Scenario: waiting_user with a parseable question shows options, not Auto Approve

- Given a task snapshot with status `waiting_user` and waitReason `target_ambiguous`
- And `pageReading` is 要打开的是哪家网页邮箱？谷歌还是微软？
- When the status card is rendered
- Then the user sees that question and option buttons 谷歌 / 微软
- And 自己写 focuses the composer
- And clicking an option sends `follow_up` through `handleSendMessage`
- And there is no Auto Approve countdown, no `resume`, no `wait-continue` / `wait-retry`

## Scenario: execute start uses the composer 仅聊天 / 执行 rail

- Given the side panel composer
- Then the input has 仅聊天 and 执行
- And choosing 执行 sends `composerIntent: 'execute'` and does not park 要我现在操作这个网页吗？
- And choosing 仅聊天 does not operate pages
- And a start without composerIntent still parks `confirm_execute` with 仅聊天 / 执行
- And there is no Auto Approve countdown

## Scenario: the card is turns, not four labeled slots

- Given a running or completed task
- When the status card is rendered
- Then the user's sentence is a bubble (`data-turn="user"`)
- And the answer and process sit in the agent turn (`data-turn="agent"`)
- And a follow-up sentence is a later user bubble, not a replacement of the first
- And after the run, process is a closed fold; opening it shows 获取页面快照 and tab switches
- And the answer uses foreground ink; the user bubble and process use softer ink
- And there is no 目标 / 现在 / 结果 / 做过 label

## Scenario: waiting_user with stored named bind choices shows those names

- Given a task snapshot with status `waiting_user` and waitReason `target_ambiguous`
- And the current round has `waitAsk` whose options are observed names 入门教程 / 进阶教程
- And `pageReading` does not contain 还是
- When the status card is rendered
- Then the user sees 这几个都对得上「教程」，要哪一个？ and option buttons 入门教程 / 进阶教程
- And the user does not see 页面上有多个相似目标
- And 自己写 focuses the composer

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

## Scenario: Completion answer typeset by text type, not by task topic

- Given a delivered answer with a section name, paragraphs, a list, and 对核 sources
- When `AnswerProse` draws it
- Then the section name is 14px / 600, body and list items are 14px / 400, sources are 12px
- And the answer block fades in once (180ms opacity), with no typewriter and no thinking sentence-in
- And a whole-line `**节名**：` is a section, while `**标签**：值` inside a list item stays a list item

## Scenario: Thinking follows what already happened

- Given a running task that has already opened a page
- When the work stream is derived
- Then 思考过程 comes after the page card, not above it

## Scenario: Thinking folds after the run, and the user can open it

- Given a running task with a human page reading
- When the work stream is derived
- Then 思考过程 is open and splits the reading into sentences (no hardcoded SENTENCES / DELAYS)
- And when status is `completed`, 思考过程 is collapsed
- And the heading copy stays 思考过程; elapsed time stays in Health
- And there is no infinite shimmer on the thinking label

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
- And tokens match the side panel near-white / ink (`#f6f6f5` / `#1c1b19`), not black / crayon
- And Options.tsx has no `#0EA5E9` / `bg-sky-*` / sky utility stacks
- And settings surfaces use yishu border/surface tokens (not stock blue toggles as primary chrome)
- And yishu component styles for options do not set `box-shadow`

## Scenario: Memory page is an independent fact editor (not a notes dump)

- Given the memory page at `memory/index.html`
- Then it imports `--chijie-*` tokens and uses a narrow column
- And empty copy names the next action (写下事实，再整理成条目)
- And the side panel opens that page from `nav_memory_a11y`
- And there is no sky chrome and no `box-shadow`

## Scenario: SidePanel.css has no legacy sky scrollbar/header chrome

- Given SidePanel.css
- Then scrollbar and header icon colors use `--chijie-*` tokens (or paper/accent hex from DESIGN.md)
- And source does not contain `#0ea5e9` / `#19C2FF` / sky-blue palette
