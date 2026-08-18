# X 调研：同类浏览器 Agent 的技术实现

Date: 2026-08-18
Scope: 对标持节（Chrome MV3 长程任务 Agent）的感知、动作、循环、形态。
Primary: 官方文档 / 官方工程博文 / 产品源码。
Secondary: X 帖（工程师自述、逆向、使用侧观察）。X 不能当唯一源。

结论先说：同类产品已经收敛到四条路，而不是十几个互不相通的架构。
持节走的是「用户日常 Chrome + 结构化 DOM + Planner/Navigator + observe-act」。
2025–2026 的主流工程争论不在「要不要 Agent」，而在：看 DOM 还是看截图、点元素还是发原始 CDP、Planner 拆开还是单循环、挂用户已登录会话还是开干净浏览器。

---

## 1. 四条实现路

```text
                    谁在跑浏览器？
                           |
     +---------------------+---------------------+
     |                     |                     |
 用户日常 Chrome        自有 Chromium           外部进程 / 云浏览器
 (MV3 扩展)            (整机浏览器)            (CDP / Playwright)
     |                     |                     |
     |                     |                     |
  持节 / Nanobrowser    ChatGPT Atlas         Browser Use CLI
  Claude in Chrome      Perplexity Comet      Stagehand
  Mariner 早期扩展      Fellou                Skyvern
  rtrvr (扩展当 MCP)                          Nova Act
                                              Playwright MCP
                                              Chrome DevTools MCP
```

四条路解决的是不同约束：

| 路 | 得到什么 | 丢掉什么 |
|----|----------|----------|
| 用户 Chrome 扩展 | 已登录 cookie、书签、本机会话 | MV3 service worker 寿命、`debugger` 黄条、跨源 iframe 难 |
| 自有 Chromium | 产品完整控制、侧栏和 Agent 一体 | 用户要换浏览器；流量看起来像真人 Chrome |
| 外部 CDP / Playwright | 可扩缩、可录屏、可云端并行 | 默认不是用户日常会话；反爬、登录要另做 |
| Computer Use 截图环 | 任何 UI 都能点，含 canvas | 慢、贵、无持久状态、坐标一抖就点错 |

持节明确选第一条：日常 Chrome，任务级自主，完成必须可核对。见 `PRODUCT.md`、`AGENTS.md`。

---

## 2. 感知与动作：真正分叉的地方

```text
页面怎么进模型
----------------
截图像素 --------+---- Computer Use / Claude 早期 / Yutori 紧环
                 |
无障碍树 a11y ---+---- Playwright MCP / Chrome DevTools MCP / Claude read_page
                 |
编号 DOM 树 -----+---- Browser Use / Atlas(据逆向) / 持节 buildDomTree
                 |
原始 CDP 事件 ---+---- Browser Use 2025 后 / Stagehand v4
                 |
混合 -----------+---- Skyvern (截图 + 简化 DOM) / Claude in Chrome (a11y 失败再截图)
```

动作怎么落地：

| 动作原语 | 谁在用 | 特点 |
|----------|--------|------|
| 点编号元素 `[12]` | Browser Use 早期、Nanobrowser、持节 | 模型输出小；依赖 DOM 抽取质量 |
| 点坐标 `(x,y)` | Anthropic Computer Use、部分 Claude in Chrome | 通用于 canvas / 图标按钮；对窗口缩放脆 |
| Playwright 选择器 / locator | Skyvern 执行层、Stagehand 确定路径 | 稳，但站点一改就碎，所以外面包 LLM |
| 发原始 CDP | Browser Use CLI 2.0/3.0、Stagehand v4 | 动作空间接近「浏览器能做的一切」 |
| 写一段 Python/脚本一次多步 | Hermes `browser_exec`、部分 CLI | token 少；一次脚本可在人看不见时连做多步 |

X 上反复出现的同一句话（不同人、不同产品）：
「每步都截图再决策，长任务会爆上下文、也慢到没法用。」
反面是：纯 DOM / 纯 a11y 在 canvas、无 ARIA 图标、嵌套 shadow DOM、跨源 iframe 上会瞎。

---

## 3. 产品对照（形态 / 看什么 / 怎么点 / 怎么循环）

### 3.1 持节（本仓库）

- 形态：Chrome MV3 扩展。service worker 里跑任务循环，侧栏报目标 / 现在 / 结果。
- 感知：注入 `buildDomTree.js`，抽可点击节点编号；`observation.ts` 再压成交互元素摘要 + 可见文本 + 可选截图引用。
- 动作：`puppeteer-core` 经 `chrome.debugger` 接到当前标签（`page.ts`）。
- 循环：`observe-act-loop.ts` 写明「browser-use architecture」；外层仍有 Planner / Navigator，另有 skill 短路（表单、媒体、列表抽取、站点捷径）。
- 完成：不只看 URL；404 / 「页面不可用」不标绿。

源：本仓库 `README.md`、`chrome-extension/src/background/`。

### 3.2 Nanobrowser（上游）

- 官方定位：开源 Chrome 扩展，Operator 平替；Planner / Navigator / Validator 可分模型。
- 一切在用户浏览器本地跑，只用用户自己的 API key。
- X 上的传播帖几乎都在复述这三点，没有更深的协议细节。

主源：https://nanobrowser.ai/docs
次源：https://x.com/rohanpaul_ai/status/1937038411564786005

### 3.3 Browser Use

这是 X 上技术密度最高的一条线，创始人 Magnus Müller `@mamagnus00` 本人在写实现。

已核对的工程事实：

1. 早期：Playwright + DOM 序列化 + 元素编号 + 可选截图。
2. 2025-08：丢掉 Playwright，直连 CDP。理由：Playwright 多一跳 Node 中继，拖慢元素抽取和截图；也挡不住跨源 iframe / 崩溃边角。
   主源：https://browser-use.com/posts/playwright-to-cdp
   关键实现：节点用 `targetId + frameId + backendNodeId + 坐标 + 回退选择器`（他们叫 super-selector）。
   标签不是一个 page，而是「根 + 跨源 iframe + worker」一簇 target。
3. 2026-01：「Bitter Lesson」——拆掉 Planner / 校验层，给模型原始 CDP + 扩展 API，再用 eval 往回收。
   浏览器状态当 ephemeral 消息，只留最近几次，否则 10 步后上下文炸掉。
   主源：https://browser-use.com/posts/bitter-lesson-agent-frameworks
4. 2025-11：Magnus 公开对照 Atlas，称 Atlas 用同一套 DOM 抽取（`node_id`、`|SCROLL|` token、属性、像素元数据），但当时还看不到跨源 iframe。
   次源：https://x.com/mamagnus00/status/1992351737311854789
5. 2026：CLI 2.0/3.0 = 直连 CDP 的 browser-harness；模型可自己写 helper 处理信用卡 iframe / shadow DOM。
   次源：https://x.com/browser_use/status/2072699513228378262
   次源：https://x.com/mamagnus00/status/2074641737365205208
6. 他们自己承认长程和跨源 iframe 仍是低垂失败点。
   次源：https://x.com/mamagnus00/status/2080302246823407860

对持节的直接含义：上游 Nanobrowser / 持节的「编号 DOM + Planner」正是 Browser Use 已经部分放弃的那一层。
他们放弃的理由是模型变强 + 动作空间不够完整，不是 DOM 抽取错了。

### 3.4 Claude in Chrome / Computer Use

两条相关但不是同一层：

**Computer Use API（2024-10）**
- 官方：喂截图，模型回鼠标/键盘动作。
- 次源：https://x.com/alexalbert__/status/1848743043429810361

**Claude in Chrome（扩展）**
- 官方权限表：`sidePanel`、`scripting`（读页）、`debugger`（点、打字、截图）、`system.display`（按屏幕尺寸点准）。
  主源：https://support.claude.com/en/articles/12012173-get-started-with-claude-in-chrome
- 逆向 / 使用侧（次源，需打折）：
  - 工具 `read_page` 走无障碍树（约 50k 字符上限），`debugger` 负责真正控制。
    https://gist.github.com/sshh12/e352c053627ccbe1636781f73d6d715b
  - a11y 不够用时退回整页截图；截图会留在后续上下文里，长任务变慢变贵。
    https://www.claudechrome.com/blog/how-claude-chrome-works
  - 用户体感：每点一次就截一张，「慢到离谱」。
    https://x.com/carlvellotti/status/2007490652444164386
    https://x.com/thismacapital/status/2087822413803192363
- Claude Code 可通过 `claude --chrome` 挂同一扩展，用的是用户已登录会话。

和持节同形态（MV3 + debugger + 用户 Chrome），感知更偏 a11y + 截图，循环更偏「聊天侧栏 + 逐步允许」，不是任务级一次授权。

### 3.5 ChatGPT Atlas

- 官方：OpenAI 自有 Chromium 浏览器（2025-10），侧栏 ChatGPT + Agent Mode。
  主源：https://openai.com/index/introducing-chatgpt-atlas/
- 实现细节官方几乎不写。X 上最具体的一条是 Magnus 的 DOM 逆向（见 3.3）。
- 安全公司 Zenity 之后披露：Claude in Chrome 和 Atlas 都能被邮件 / X 帖做零点击注入，拿去接管账号或下单。
  次源：https://x.com/AlexNguyen65/status/2086550792480125057
  转述：https://www.securityweek.com/zero-click-ai-browser-hacking-claude-and-chatgpt-atlas-hijacked-via-emails-x-posts/

形态上 Atlas 是「换浏览器」，不是「挂进你正在用的 Chrome」。这和持节不是同一产品。

### 3.6 Project Mariner / Gemini in Chrome auto browse

- 官方（2024-12）：实验性 Chrome 扩展；Gemini 同时看像素和页内元素（文本、代码、图、表单）。
  单智能体 WebVoyager 报 83.5%。
  主源：https://blog.google/innovation-and-ai/models-and-research/google-deepmind/google-gemini-ai-update-december-2024/
  次源：https://x.com/sundarpichai/status/1866868770678988850
- 2026-01：Chrome 原生 auto browse（Gemini 3），不再只是实验扩展。
  次源综述：https://nohacks.co/blog/agentic-browser-landscape-2026
- 2026-03：Google 给这类请求单独 UA `Google-Agent`，并试 Web Bot Auth。

感知官方自称「像素 + 元素」，不是纯 DOM 编号。产品路径是「先扩展、再吃进 Chrome」。

### 3.7 Skyvern

- 官方循环（每步）：截视口 → 抽简化 DOM（带标签和位置）→ LLM 选动作 → Playwright 执行 → 检查目标。
- V2 外层：Planner 拆子任务 → Task Agent 跑上面的环 → Validator 看总目标，不对就打回 Planner。
- 密码 / TOTP / 卡号走凭证库注入，模型看不见明文。验证码、代理、会话档案是产品层，不是模型层。

主源：https://www.skyvern.com/docs/developers/getting-started/introduction
GitHub：https://github.com/skyvern-ai/skyvern

角色名和 Nanobrowser / 持节几乎同构。差别：Skyvern 跑云端/自托管 Chromium，默认截图+DOM；持节跑用户 Chrome，默认 DOM。

X 上有人用 Skyvern 自己的评测说：写操作（表单、登录）比读操作差。
次源：https://x.com/pystar/status/2089387420361834907

### 3.8 Stagehand（Browserbase）

- 官方：给 Agent 的 SDK，不是完整产品 Agent。
- 原语：`act` / `extract` / `observe`；同一脚本里可混用 Playwright 风格的确定 API。
- v4 明确：经 CDP 驱动 Chromium，不再依赖 Playwright / Puppeteer。
- 自称「手」：脑子用 LangChain / CrewAI / 自写循环。

主源：https://docs.stagehand.dev/v4/first-steps/introduction
次源：https://x.com/_philschmid/status/1976649107931324586

对持节：这是「把浏览器控制做成库」的路线。持节把脑子和手焊在同一个扩展里。

### 3.9 Playwright MCP 与 Chrome DevTools MCP

两条给编码 Agent 用的浏览器手，不是面向终端用户的任务产品。

**Playwright MCP**
- 官方一句话：用无障碍树快照，不靠截图，不需要视觉模型。
- 2026 他们自己开始劝编码 Agent 改用 CLI + Skills，因为 MCP 工具 schema + 整棵 a11y 树太吃 token。
  主源：https://github.com/microsoft/playwright-mcp

**Chrome DevTools MCP**
- 官方 Chrome 团队：给编码 Agent 的 DevTools。
- 能力：点、填、滚、截图、完整 a11y 树、网络/控制台、性能轨迹。
  主源：https://github.com/ChromeDevTools/chrome-devtools-mcp

**Vercel agent-browser（X）**
- 给 a11y 元素叠编号标注截图，把「看见」和「能点」对上。纯文本快照快但不覆盖 canvas / 无 ARIA 按钮。
  次源：https://x.com/ctatedev/status/2024346489456144735

### 3.10 Amazon Nova Act

- 官方：模型 + 编排器 + SDK + 浏览器执行器一起用 RL 在网页 gym 里训。
- 开发者写 `act("把这个表单填完")` 这种自然语言步，不是自己维护 Planner。
- 云端走 Bedrock AgentCore Browser，用 CDP websocket 把会话交给 SDK。

主源：https://docs.aws.amazon.com/nova-act/latest/userguide/what-is-nova-act.html
主源：https://github.com/aws/nova-act

这是「专用浏览器模型」路线。持节是通用 LLM + 本地 harness。

### 3.11 rtrvr：扩展变成远程 MCP

- 形态仍是 Chrome 扩展，但把用户浏览器暴露成远程 MCP 端点。
- 任何外部 Agent（Claude Code、Cursor、自写）拿一个 URL 就能驱这台已登录的 Chrome。
- 解决的是互操作，不是更好的感知。

次源：https://x.com/ai_for_success/status/1989518965731897713
主源：https://www.rtrvr.ai/blog/browser-as-mcp-server

持节如果要被 Claude Code / Grok 当手用，这是最近的产品形态参考。不是现在必须做。

### 3.12 Comet、Fellou、Manus、Yutori、WebBrain

X 上声量大，可核实现少。

| 产品 | 能核实的 | 不能当事实的 |
|------|----------|----------------|
| Perplexity Comet | 自有 Chromium + 内置助手；能代为点、填、管邮件日历（产品稿） | 「认知操作系统」是营销 |
| Fellou | 自称第一家 Agentic Browser；Deep Search 会开多个影子浏览器并行 | 感知/动作协议未见工程披露 |
| Manus | 2026-07 出 Plan Mode：先出规格再执行 | 浏览器内核未公开 |
| Yutori | Together AI 说他们的环是「截图-动作」紧环，自训 Navigator 模型降成本 | 无独立协议文档 |
| WebBrain | 作者自称：先 URL/标题，再可见性过滤的 a11y 或抽文本，硬上限+分页，截图可选 | 单人项目自述 |

Comet：https://x.com/WesRoth/status/1932052559314727111（产品叙事）
Fellou：https://x.com/rohanpaul_ai/status/1920883216912675107
Yutori：https://x.com/togethercompute/status/2088807960457699509
WebBrain：https://x.com/EmreSokullu/status/2087956567136063921

### 3.13 长程任务本身

X 上和技术帖重合的共识：

1. 无持久会话的云 Computer Use 每步都要从屏幕重建状态，几步以上就开始漂。
   次源：https://x.com/stretchcloud/status/2089433581789589601（评 Browser Use 的 macOS Harness：本地进程保住 a11y 树）
2. Planner 和 Executor 拆开会抬 Web 导航成功率；WebArena-Lite / WebVoyager 数字需当广告读。
   次源：https://x.com/adil_kadival/status/2087375547857027477
3. 压缩控制面（一个 `browser_exec` 而不是二十个 click/type 工具）能少 48–66% token，但一次脚本能在人看见下一轮之前连做很多动作。
   次源：https://x.com/noxleeminho/status/2087092396047683945（Hermes + Browser Use CLI 3.0）
4. 写任务（表单、登录、付款）全面弱于读任务。这和持节把 form-fill、登录等待做成 skill / `waiting_user` 是同一类现实。

---

## 4. 对持节：该信什么，不该跟风什么

已经和仓库对齐的部分：

```text
持节现在
--------
用户 Chrome (MV3)
    |
    +-- chrome.debugger + puppeteer-core     ← 和 Claude in Chrome 同权；和 Browser Use「弃 Playwright 中继」同方向，但还隔着 puppeteer
    +-- buildDomTree 编号元素               ← 和 Browser Use / Atlas 同族
    +-- observe → decide → act → reobserve  ← 注释里写了学 Browser Use
    +-- Planner / Navigator (+ Validator 遗迹) ← 和 Nanobrowser / Skyvern V2 同族
    +-- skill 短路（表单、媒体、列表、站点）
    +-- 完成必须有可核对证据
```

X + 官方合在一起，值得盯的缺口（不是现在就要改）：

1. **跨源 iframe / shadow DOM**
   Browser Use 反复说这是 DOM 编号派的生死线。付款、登录、广告同意框经常在这里。
   持节的 `buildDomTree` 会进子 frame，但是否覆盖 OOPIF，要用真实付款页打，不能靠感觉。

2. **上下文膨胀**
   Browser Use 用 ephemeral 状态（只留最近 N 次 DOM/截图）。
   Claude in Chrome 把截图留在对话里，用户骂慢。
   持节已有 `compactStateText` / 可见文本上限；长程任务要盯「第 30 步时观察还清不清」。

3. **动作空间完不完整**
   对方在给模型原始 CDP，让它自己写 helper。
   持节走的是封闭动作表 + skill。
   这不是对错：持节要的是可核对交付，不是「模型什么都能试」。
   但封闭表在 canvas / 自定义控件上会撞墙，那是截图或 CDP 的领地。

4. **不要为了跟风换成纯截图环**
   X 上用过 Claude in Chrome / Yutori 的人都在报每步截图的延迟。
   持节的产品是日常 Chrome 里把一件事做完，不是演示视觉 Agent。

5. **不要为了跟风拆掉完成核对**
   Browser Use 的 bitter lesson 是「少框架、多动作空间」。
   持节的产品约束是「交得出能核对的结果」。这两句话不在同一层。
   循环可以变简单；「404 也能标绿」这种完成定义不能变简单。

6. **形态不要走错棚**
   Atlas / Comet / Fellou 是换浏览器。
   Skyvern / Nova Act / Browser Use Cloud 是云端浏览器。
   rtrvr 是把已登录 Chrome 租给别的 Agent。
   持节如果还是「你把事交出去，在你自己的 Chrome 里做完」，就继续钉在 MV3 + 本机会话。

---

## 5. 证据分级与缺口

已核实（可点回主源）：

- Nanobrowser 三角色 + 本地 key：官方文档。
- Browser Use 弃 Playwright、super-selector、ephemeral state、原始 CDP：官方博文。
- Claude in Chrome 权限与 debugger：Anthropic 帮助中心。
- Mariner 像素+元素、WebVoyager 83.5%：Google 官方博文 + Sundar 帖。
- Skyvern 截图+DOM+Playwright、Planner-Agent-Validator：官方文档。
- Stagehand v4 走 CDP、act/extract/observe：官方文档。
- Playwright MCP 用 a11y 不用像素：官方 README。
- Nova Act 整栈 RL + AgentCore CDP：AWS 文档 / GitHub。
- 持节 DOM + puppeteer-debugger + observe-act：本仓库。

仅 X / 逆向，当假说：

- Atlas 内部 DOM 协议与 Browser Use 同构（只有 Magnus 一张对照图）。
- Claude in Chrome 的工具表和 a11y 生成器（gist / 第三方拆包）。
- Comet / Fellou / Manus 的内核。
- Hermes 少 48–66% token（他们自己的 204 次运行）。

这次没在 X 上挖到可引用实现细节的：Dia、Arc Max、MultiOn、Adept、Genspark 内核、Opera Neon。

---

## 6. 关键链接

官方 / 源码

- https://nanobrowser.ai/docs
- https://browser-use.com/posts/playwright-to-cdp
- https://browser-use.com/posts/bitter-lesson-agent-frameworks
- https://support.claude.com/en/articles/12012173-get-started-with-claude-in-chrome
- https://blog.google/innovation-and-ai/models-and-research/google-deepmind/google-gemini-ai-update-december-2024/
- https://openai.com/index/introducing-chatgpt-atlas/
- https://www.skyvern.com/docs/developers/getting-started/introduction
- https://docs.stagehand.dev/v4/first-steps/introduction
- https://github.com/microsoft/playwright-mcp
- https://github.com/ChromeDevTools/chrome-devtools-mcp
- https://docs.aws.amazon.com/nova-act/latest/userguide/what-is-nova-act.html
- https://www.rtrvr.ai/blog/browser-as-mcp-server

X（高信号）

- https://x.com/mamagnus00/status/1992351737311854789  Atlas DOM 对照
- https://x.com/mamagnus00/status/2074641737365205208  原始 CDP 打穿付款 iframe
- https://x.com/mamagnus00/status/2082148058008264861  「raw CDP 看起来浪费，但能覆盖边角」
- https://x.com/browser_use/status/2035187981695475824  MCP vs CLI、Playwright vs CDP
- https://x.com/alexalbert__/status/1848743043429810361  Computer Use API
- https://x.com/sundarpichai/status/1866868770678988850  Mariner
- https://x.com/ctatedev/status/2024346489456144735  标注截图
- https://x.com/stretchcloud/status/2089433581789589601  云 CUA 无状态 vs 本地 a11y
- https://x.com/EmreSokullu/status/2087956567136063921  过滤 a11y，截图可选
