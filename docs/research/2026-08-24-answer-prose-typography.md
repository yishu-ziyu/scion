# 调研：侧栏完成正文怎么排

日期：2026-08-24
对象：任务完成后，侧栏 `AnswerProse` 给用户看的那段字。
不是：思考过程文案、token 流、按任务写死「先说这页是什么」。
Tabbit 图是参考，不是规格。活零件点头之前不搬代码。

## 问题

用户派的任务每次都不一样。
视觉规则必须按**文本类型**排（字号、字重、组距），不能按任务题意排。

## 持节现在（源码）

| 层 | 路径 | 事实 |
|---|---|---|
| 画 | `pages/side-panel/src/components/AnswerProse.tsx` | 块 → `<p>` / `<ul>` / `<ol>`；句内 `**` → `<strong>`；host 匹配 → 链接钮 |
| 解析 | `pages/side-panel/src/presentation/answer-format.ts` `parseAnswerBlocks` | 只认段落、无序、有序、粗体。不认 `#` 标题、表格、代码块、引用、`[text](url)` |
| 样式 | `pages/side-panel/src/design/chijie-components.css` `.chijie-answer` | `p` 和 `li` 都是 **14px / 400 / 行高 1.65**；块间距 **10px**；`strong` 只加到 600 |
| 来源 | 同文件 `.chijie-answer-sources` | 标题「对核这些页」12px；行距 6px |
| 令牌 | `pages/side-panel/src/design/chijie-tokens.css` | 已有 xs11 / sm12 / md14 / lg16；400/500/600。注释写「3–5 type steps」。**完成正文没用这些令牌**，写死了 14px |
| 模型 | `chrome-extension/src/background/agent/backends/control-policy.ts` 规则 13 | `done` 时 `observation` 是给用户的结果。禁止 JSON 外的 markdown 围栏。**没有**要求 observation 里用标题 / 列表分行 |
| 测试墙 | `answer-format.test.ts` | 模型常把 `**标题**： - 条目` 写在一行。解析器硬拆成 p+ul+ol，拆完视觉仍一样大 |

思考过程：`WorkStream.tsx` `<details class="chijie-thinking-fold">`，标题「思考过程」，12px 淡色。`deriveWorkStream` 把 `open` 设成进行中为真，等于跑着就展开。

禁止预印「目标 / 现在 / 结果」：`AGENTS.md`、`ui-acceptance.feature.md`。

## 对照（最终答，不是 thinking）

| 来源 | 类型怎么分 | 字号档 | 证据 |
|---|---|---|---|
| 持节 | p / 列表 / 粗体 / 答后来源 | 正文 14 + 来源 12，几乎两档且正文内部无差 | 上表 |
| Claude 嵌在对话里的界面 | 官方要求 **三档尺寸（heading / body / caption）× 两档字重（regular / emphasized）** | heading/body/caption；body token 16px | https://claude.com/docs/connectors/building/mcp-apps/design-guidelines |
| Apple HIG Typography | 层级靠 **字重、字号、颜色**；少混字体；长文用更松行高 | macOS 默认 13pt，下限 10pt | https://developer.apple.com/design/human-interface-guidelines/typography |
| Apple HIG Layout | 相关的放一组；组间用空白分开；必要信息留空，次要藏起来 | — | https://developer.apple.com/design/human-interface-guidelines/layout |
| NN/g Visual Hierarchy | 对比、尺度、分组；建议 **2–3 个字号档** | — | https://www.nngroup.com/articles/visual-hierarchy-ux-definition/ |
| Refactoring UI（Notion Will's S） | 不全靠放大；用字重和颜色；组间距 > 组内；标题不必做成巨大 h1 | 正文 + 粗体两档字重即可 | Hierarchy is Everything 全簇；Designing Text「Establish a type scale」 |
| 主人文章字阶 `DESIGN.md` §24.2b | **H3 与正文同为 14px，只靠 600 分节**；大声只留给页级 H1 | 14/400 正文，14/600 节名 | `~/Documents/design-notes/DESIGN.md` |
| living/type | 栏宽 576px；h3 **14px/600**，上边距 28 下边距 8 | 文章页，不是侧栏 | `~/Documents/design-notes/living/type/index.html` |
| Material 3 | 长文用 Body；Display 不给长答 | Body M 14/20 | https://m3.material.io/styles/typography/applying-type |
| Tabbit 活跑 | 完成是 **一行**「页面标题是: Example Domain」，略重；思考过程折叠 | 未测 px | `docs/research/tabbit-lab/shots/26-taskmode-t14.png` |
| ChatGPT 网页 | `.markdown.prose`：标题/列表/代码/表；正文看起来 ~16px | 未对本机 DevTools 实测 | 第三方 userscript 打 `.markdown.prose`；不当硬数 |
| Perplexity 官方 prompt | 内容契约：`##` 节、列表、行内引用；**最多 5 节**；每段最多一个加粗词 | 这是搜索引擎的作文规矩，不是侧栏 CSS | https://docs.perplexity.ai/docs/agent-api/prompt-guide |
| GitHub markdown.css | h1 2em / h2 1.5em；**h4 = 1em / 600**（与正文同号只加粗） | 文章渲染，侧栏直接搬 h1/h2 会炸 | https://gist.github.com/gamemaker1/c15fbec6deeb1d274aebe909f8305b54 |

未登录实测：ChatGPT / Grok / Sider 精确 heading rem。表里不编像素。

## 和这次问题对齐的结论

1. **痛点是类型没有视觉差。** 持节已经能拆出 p/ul/ol，但 CSS 把它们画成同一面 14px 墙。眯眼测试过不去（NN/g）。
2. **侧栏不该搬 ChatGPT/GitHub 的大标题阶。** 窄栏里 h1 2em 是 Display，Material 3 明确 Display 不给长文。主人自己的文章阶也是节名与正文同号。
3. **最贴的官方窄栏规矩是 Claude：三尺寸 × 两字重。** 持节令牌已经是 11/12/14/16 和 400/600，只是完成正文没用。
4. **组距是第二缺口。** 现在块间距一律 10px。Refactoring UI「Avoid ambiguous spacing」：节与节 > 节名到列表 > 列表项之间 > 行内。Apple Layout：相关的靠近，无关的拉开。
5. **解析器缺「节名」这一型。** 模型写 `**页面结构**：` 时，它还是段落里的粗体，不是节名块。只改 CSS 救不了「类型」。不必为了任务语义发明「结论句」类型。
6. **不要抄 Perplexity 的作文模板**（先 1–2 句答案、最多 5 节）。那是搜索产品对模型的内容契约。主人已否决按任务预设第一句写什么。
7. **Tabbit 完成常常是一行。** 一行时类型阶仍成立：就是一段正文，可有句内加粗。不要为了一行去造栏目。
8. **思考过程已经是次要层**（12px 淡色 + 折叠）。进行中强制 `open` 和「用户自己选」相反，属折叠行为，不是答文排版。

## 建议的类型表（调研结论，还不是规格）

侧栏完成正文只用三档尺寸、两档字重。数字用已有令牌。

| 类型 | 何时 | 字号 | 字重 | 颜色 | 间距 |
|---|---|---|---|---|---|
| 节名 | 单独一行的小节标题（解析出来的 heading，或整行只是 `**…**`） | `--chijie-text-md` 14px | 600 | `--chijie-foreground` | 上边大于下边（贴住它管的那组） |
| 正文 | 普通段落 | 14px | 400 | `--chijie-paper-ink` | 段与段中等 |
| 列表项 | ul / ol | 14px | 400 | 同正文 | 项间距 > 行缝；整表贴节名 |
| 句内加粗 | `**…**` | 继承 | 600 | 同正文 | 不另起块 |
| 来源层 | 「对核这些页」+ 行 | 12px / 11px host | 400 | `--chijie-muted` | 与正文组距大于来源组内 |
| 思考摘要 | 「思考过程」 | 12px | 400 | muted | 默认收起 |

不做（调研范围内）：表格、代码块、引用、ChatGPT 级 h1、预印「结果」标签、把 `living/type` 衬线长文搬进侧栏。

## 不做的抄法

- 不抄 Tabbit 评分（成功交付 / 部分完成 / 未完成）。
- 不抄 Tabbit「仅聊天 / 执行」。
- 不把文章页 H1 36px 放进 Chrome 侧栏。
- 不把 Perplexity「先写一句直接答案」写进产品契约。
