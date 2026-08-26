# Feature: Side panel uses 持节 design system (not stock SaaS chrome)

Source of truth: `~/Documents/design-notes/DESIGN.md`

## Background

- No stock sky-blue chrome. Colors come from `--chijie-*` tokens, not a mandatory paper/crayon look.
- No `box-shadow`; hierarchy via surface steps.
- Body: Space Grotesk; labels: Space Mono ALL CAPS; no sky-blue default chrome
- Primary actions are pill buttons
- Task language is human, not raw enum strings

## Scenario: Live run is a conversation plus one closed fold

- Given a task snapshot with status `running`
- When the status card is rendered
- Then the user's original sentence is a quiet right-aligned bubble (`--chijie-accent-subtle`, not a sand card) with no 目标 label
- And there is no 后台进行 presence row (header already says 进行中)
- And process is one closed disclosure: chevron + 正在读取 · site, or the current human action
- And 获取页面快照 / 思考中 / 搜索网页 are not action chips
- And there is no pulsing now-line capsule, no matrix dots, no numbered step chips
- And 接管 is a quiet underline on the fold, not a pill on the stream
- And opening the fold is the only way to see search boards / pages / clicks

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

## Scenario: Running process is a closed fold, not a now-line dashboard

- Given a task snapshot with status `running` and at least one attempt in flight
- When the status card is rendered
- Then a closed fold (`task-process-disclosure` with `data-live`) shows `task-now-summary` (正在读取, or the current human action) and optional `task-now-site`
- And the work stream is inside that fold, closed by default
- And the work stream blocks have no step numbers

## Scenario: Waiting for page proof shows the produced answer and a retry

- Given a task snapshot with status `waiting_user` and waitReason `proof_required`
- And the round has a produced answer and no `user_confirmed` criterion
- When the status card is rendered
- Then the produced answer is promoted as `produced-answer`
- And a `proof-retry` button (再说一次) is offered
- And the next-step copy says the result is in hand but page evidence did not match
- And the copy never says 没有写出可检查的结果

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

## Scenario: one send, one loop

- Given the side panel composer
- Then the input has no 仅聊天 / 执行 rail
- And a send starts the same loop whether the sentence is a question or a page task
- And the loop may answer without attaching to a page, or attach and operate
- And there is no Auto Approve countdown

## Scenario: Side panel motion comes from transitions.dev, not a second palette

- Given the side panel
- Then motion tokens and `t-*` snippets are imported after 持节 tokens
- And attachment / mention menus use the dropdown open/close
- And history vs chat uses the side-by-side page slide
- And the wait-ask options use panel-reveal
- And every snippet keeps `prefers-reduced-motion`
- And motion CSS does not set `box-shadow`

## Scenario: the card is turns, not four labeled slots

- Given a running or completed task
- When the status card is rendered
- Then the user's sentence is a bubble (`data-turn="user"`)
- And the answer and process sit in the agent turn (`data-turn="agent"`)
- And a follow-up sentence is a later user bubble, not a replacement of the first
- And after the run, process is a closed fold; opening it shows tab switches and pages, not 获取页面快照 as a chip
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
- And each 对核 source is one compact line (host + truncated title), not a stacked card
- And 复制结果 is a quiet ghost button (no border pill) trailing the answer
- And inside the closed-then-opened process fold, page cards and act chips are plain small-text rows, not sand cards
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
- And the thinking label carries a soft shine sweep only while the run is live, and returns to plain muted text when done

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

## Scenario: Chat floats as Document Picture-in-Picture from the side panel

- Given the side panel chat
- When the user clicks 画中画
- Then the same chat moves into a Document PiP window requested from the side panel document
- And `chrome.windows.create` is not used for this float
- And switching content tabs does not close it because the opener is the side panel
- And closing the side panel closes the PiP
- And the side panel shows 聊天已浮出 while the chat is floating
- And there is no second composer or second agent
