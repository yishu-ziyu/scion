# 持节 开发日志

项目：持节 / Chijie（仓库 `scion`）
新条目写在最上面。

---

## 2026-08-19 用户那一句在 TaskManager.dispatch 里分类

侧栏不再发 `user_turn_decision`。`TaskManager.dispatch` 在 `this.transition` 外调用 `decideUserTurn`（先 `resolveUserTurnCheap`）。不是页面任务则 `not_executable`，不建任务。`follow_up` 的「停止」走 `cancel`。技能接住时 `tryDecide.decision` 就是 `LoopDecision`。`understandingAnswerSkill` / `themeCitationSkill` 不进 `defaultSkills()`。

### 验证

`user-turn-decision`、`manager` 的 classify 用例、`runtime`、`ui-acceptance`。

---

## 2026-08-18 失败后只留目标和结果

### 用户场景

任务停了。侧栏叠：失败了胶囊 + 失败了没有可交付结果 + 空的结果 + 本次任务完成得怎么样 + 失败原因「模型反复失败或步数耗尽」。

### 怎么做

失败卡按 目标 → 结果 → 做过 读。结果一句人话（试了几轮，还是没做成），主按钮「再说一次」直接再跑同一句。不做失败胶囊、不打分、不重复目标、思考过程不说「没做成」。步骤收到结果下面的「做过」。

### 验证

`task-status-card-identity` 失败卡渲染、`failed-result`、`now-trace` 失败不写思考、`mission-plan-list` 做过在结果后、`ui-acceptance`。

---

## 2026-08-18 任务开始 50 秒执行步骤是空的

### 用户场景

B 站任务「打开这个网页的第二行的第一个视频」跑了约 50 秒，现在只有「正在看 首页-个性推荐-哔哩哔哩」，执行步骤是空的。

### 原因

`ActionAttempt` 原先只在 `dispatchAction` 第一次点/填页面时写入。循环先 `kernel.observe`（`getState` 会 `waitForPageAndFramesLoad`，B 站首页网络几乎闲不下来，最多等满 5 秒）再调模型。这两段都不写步骤。侧栏只能回落到「正在看 {标题}」。

不是死了。是做了、没报。

### 怎么做

- 任务一开始就写入一条执行中的「获取页面快照」。`runObserveActLoop` 的 `onPhase` 会等写入完成再开始看页。模型开始想的时候，这一条变成已完成，思考过程显示「思考中」。
- 第一次看用户已经打开的页，不再走 `waitForPageAndFramesLoad`。点完之后的再观察仍会等。

### 验证

`loop-phase-attempt`、`observe-act-loop`（先写步骤再 observe）、`manager` 启动即有快照步骤、`022-kernel` `waitForLoad: false`、`now-trace` 决定阶段显示思考中。type-check 过。

`form-journey` / `skill-journey` 各有一条 `mission_plan_unverified` 在这次改动关掉种子步骤后仍失败，是原有的完成回执和计划核对，不是这次空白步骤的问题。

---

## 2026-08-18 现在 / 结果 / 任务页捆在一起

### 用户场景

对照 Tabbit 活跑：现在要有思考过程和执行步骤清单；结果要一句话并让人打分；任务打开的网页要捆成一组。

### 怎么做

- 现在：`NowTrace` 两块。思考过程是当前在干什么（不是模型英文长推理）。执行步骤是全部动作清单，导航 / 快照用人话。
- 结果：任务一完成就出一句话。成功交付 / 部分完成 / 未完成不再卡在旧回执门上。
- 页：Chrome 标签组 `任务 · …`，任务绑上和新开的页进同一组。不激活。没有 `tabGroups` 的浏览器跳过。

### 验证

`now-trace`、`task-tab-group`、`context` 标签组、`task-loop-ui` 打分、`ui-acceptance` 文案。

---

## 2026-08-18 用 Tabbit 跑完一条真任务

### 用户场景

具体用 Tabbit 发任务，看它给用户的交互。给了 15 分钟前台。

### 跑了什么

Tabbit Browser 新建标签页（没动飞书那页），发：打开 example.com，只回页面标题。
会话 `https://web.tabbit.com/session/a3a02023-f295-488f-a4fd-f5c2601baf29`。
国际版 `Tabbit.app` 同路径会停在「请先登录」。

### 用户实际看到的

新标签页统一框 → 输入后分 Chat / Google → 新对话自动改标题 → 思考中 → 停下来问「仅聊天 / 执行」→ 执行后左侧任务组 + 中间网页 + 右侧任务栏 → `操作中` + `跟随中` → 执行步骤（导航 / 快照 / 标题）→ 结果一行字 → 问成功交付 / 部分完成 / 未完成。

截图在 `docs/research/tabbit-lab/shots/17` 到 `26`。

### 这次不改持节

持节已经是侧栏报目标 / 现在 / 结果，默认不抢页，跟随和接管是用户自己开。
Tabbit 的「先问再动手」和右侧聊天栏，跟持节不是同一类产品。
`@当前页` 上一轮已经按 Tabbit 输入框补过。

---

## 2026-08-18 Tabbit 再用：@当前页，computer-use 不抢前台

### 用户场景

再用美团 Tabbit，按使用反馈改持节。
computer-use 过程中也不能抢前台。

### 怎么用 Tabbit

未开 Orca 窗口：`orca serve`（无桌面窗）。
`list-apps` / `list-windows` / `get-app-state --no-screenshot`，没有 `--restore-window`。
Tabbit Browser 更新日志页在后台，AX 树几乎是空的（未聚焦的网页常见）。
对照已有截图 `docs/research/tabbit-lab/shots/02-tabbit-app.png`：输入框里有 `@` 和模型列表。

### 反馈后怎么改

持节输入框补 Tabbit 那种 `@`：
- 输入 `@` 或点 `@` 按钮，选当前页
- 插入 `@当前页`
- 发给任务时展开成 host · 标题 · URL
侧栏原来的「当前页面」条还在，任务仍绑发送时的标签。

### 验证

`composer-mention.test.ts`、`ui-acceptance` 相关断言。
未对 Tabbit / Chrome 使用 `--restore-window`。

---

## 2026-08-18 跟随和接管

### 用户场景

默认不抢前台之后，用户要能自己选：
- 跟随：允许前台被切走，眼睛跟着 Agent 的页走。
- 接管：对操作不满意时，随时把页面收回来自己开。

### 怎么做

默认仍是后台附着。
侧栏运行中露出「跟随」「接管」。页上的操作条同样两颗按钮。
`set_follow` 打开 `TaskSession.followForeground`，`BrowserContext.setRevealForeground(true)`，并立刻 `revealTab`。
此后 `switchTab` / `openTab` 才写 `active: true`。
`takeover`：关掉跟随、把任务页拉到眼前、按暂停停掉 Agent。进度还在，可以按「继续」。
「停止任务」仍在「更多」里，会取消整单。

### 验证

单测：`run-presence`、`context` 跟随才激活、`page-operating` 命令、`manager` 跟随/接管、`ui-acceptance` 侧栏按钮。

---

## 2026-08-18 使用不抢前台

### 用户场景

对照美团 Tabbit（`docs/research/tabbit-lab/shots/02-tabbit-app.png`）再迭代持节。
操作 Tabbit / 截图时把窗口拉到前台，打断了用户正在看的页。
用户要求：使用过程不打扰前台活动。

### 从 Tabbit 看到的差距

Tabbit 首页是统一输入框（搜索 + `@` + 模型），左侧按任务分组。
持节是 Chrome 侧栏，壳不一样，那些可以后做。
更大的问题：持节自己也会抢页。`BrowserContext.switchTab` / `openTab` / `navigateTo` 写死 `chrome.tabs.update` / `create` 的 `active: true`。用户切去回邮件，下一步动作又把任务页拉回来。

### 反馈后怎么改

- `switchTab`：只附着，不 `update({ active: true })`。被 Chrome 丢掉的后台页 `reload`，仍然不激活。
- `openTab` 和新开空白页：`create({ active: false })`。
- `navigateTo`：只改 `url`，不写 `active`（写 `true` 会抢页，写 `false` 会把用户从正在看的页踢走）。
- `find_tab { active: true }`：任务已经绑过页之后，不再跟到用户新点开的前台页。
- 模型说明：`switch_tab` / `open_tab` 不把页带到前台；不要用 `tab_state active` 当完成条件。
- 侧栏仍报目标 / 现在 / 结果。任务页上的「持节正在操作这个页面」还在，用户切走就看不见。

### 验证

`chrome-extension` 里 `context.test.ts` / `control-policy.test.ts` 相关单测。
未再操作用户的 Tabbit / Chrome 窗口。

---

## 2026-08-18 分析题失败：结论必须是页面原话

### 用户场景

哔哩哔哩首页，指令：「现在这个页面的视频都是跟什么有关的」。
侧栏失败：「失败了，没有可交付结果」「没有写出可检查的结果」。
任务 `92a32d29-6423-409f-8f9d-361ce6158879`，分类 `no_action`。

### 原因

页面已经读到（约 1.2 万字）。
缺的是分析：把标题当材料，归纳这些视频在讲什么。
产品把「完成必须可核对」写成了「答案里必须有一段页面原文」。
归纳句不在首页上，所以失败。
侧栏那句「没有写出可检查的结果」是错分类。

### 反馈后怎么改

取消「结论必须是页面原话」作为完成关卡。
空话（好的我来）仍不算结果。
打开、点击、填写仍看页面有没有变。

对照 Kimi WebBridge（美团 Tabbit 里已装，官方守护进程 `127.0.0.1:10086`）：
他们的循环是 snapshot → 点 `@e` / evaluate → 直接写结论，不要求结论是原话。
example.com 点 Learn more 进 IANA 已跑通。
截图：`docs/research/webbridge-lab/shots/`。
笔记：`docs/research/webbridge-lab/NOTES.md`。

持节对齐：
- 完成关卡不再要求 `findAnswerSpanOnPage`
- 新增 `find_tab`、`evaluate`；`snapshot` 是 `observe` 的别名
- 提示改为：先读再写分析

### 验证

相关单测已过（manager / verifier / control-policy / find-tab / activity-stream）。
`dist/background.iife.js` 已更新。
**未**在用户哔哩哔哩首页再跑一遍持节。
重载未打包扩展后，同一句再发一次才算线上过关。
