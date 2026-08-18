# Tabbit lab

Two apps on this machine:

- `Tabbit.app` (`com.tabbit-ai.Tabbit`, 1.9.22) - international. NTP `https://web.tabbitbrowser.com/newtab`. Chat needs login.
- `Tabbit Browser.app` (`com.tab-browser.Tabbit`, 1.6.20) - Chinese daily. NTP composer says 输入关键词搜索. Logged in. This is the one that finished a live task.

## 2026-08-18 live run (user granted 15 min foreground)

Task sent in Tabbit Browser, new tab, not the Feishu work tab:

`打开 https://example.com ，只告诉我页面标题是什么。不要改任何设置，不要登录，不要关标签。`

Session: `https://web.tabbit.com/session/a3a02023-f295-488f-a4fd-f5c2601baf29`

Shots: `04` changelog, `06` NTP, `07` typed, `10-11` Tabbit.app login wall, `17-18` Browser NTP, `19-20` thinking, `21-22` 仅聊天/执行, `24` task mode, `25` 操作中+跟随中, `26` result + rating.

What the user sees, in order:

1. New tab is a unified box. Type → two rows: Chat, or Google search.
2. Chat opens a thread titled 新对话, then auto-renames from the instruction.
3. First it only thinks (`思考中`). Long English 思考过程 is visible.
4. Then it stops and asks: 开启 Tabbit 任务模式，操作相关标签页来完成此任务. Buttons: 仅聊天 / 执行.
5. After 执行: chrome splits. Page (example.com) in the middle. Right dock is the task. Left rail becomes `任务 2` with the chat tab + Example Domain.
6. While operating: `操作中: Example Domain` and a `跟随中` pill. Composer: 任务执行中，可继续补充信息. Stop square in the box.
7. 执行步骤 lists: 页面导航 / 获取页面快照 / 页面标题是 Example Domain.
8. Done: the answer is a line in the dock (`页面标题是: Example Domain`). Then `本次任务完成得怎么样？` 成功交付 / 部分完成 / 未完成.

Do not copy into 持节: the 仅聊天/执行 gate (持节 is not step approval), the right-dock chat (持节 is not sidebar chat), default 跟随中 (持节 default is no-steal).

Already taken from earlier Tabbit look: composer `@当前页`.
