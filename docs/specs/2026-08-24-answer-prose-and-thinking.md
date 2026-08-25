# 完成正文类型 + 思考过程折叠

日期：2026-08-24
产品：持节侧栏。根目录 `SPEC.md` 仍只覆盖进行中的 WorkStream，本文不改那份。

参考不是规格：aicss Thinking + Reasoning、aicss Text Response、Tabbit 截图。活零件点头前不搬 `living/type` 代码。

## 场景

用户派任意任务。完成后侧栏那一段给人看的字，要按文本类型排（字号、字重、组距），不能按任务题意排。
思考过程可以动：跑着展开、按句淡入、做完默认收起，用户再点开。
完成正文最多整块淡入一次。不对已经到手的答再打字、不扫光、不把思考那套句入场搬到答上。

## 现在

- `parseAnswerBlocks` 只认 p / ul / ol。整行 `**节名**：` 仍是段落里的粗体。
- `.chijie-answer` 里 p 和 li 都是写死的 14px / 400 / 间距 10px。
- 思考过程是 `<details class="chijie-thinking-fold">`，`open: running`。`.chijie-thinking*` 样式已在 CSS 里但没接到组件。无限扫光已按 design/008 删掉。

## 完成正文类型表

| 类型 | 何时 | 字号 | 字重 | 颜色 | 间距 |
|---|---|---|---|---|---|
| 节名 | 整行只是 `**…**`，或后面只跟 `：` / `:` | `--chijie-text-md` | 600 | `--chijie-foreground` | 上边大于下边；第一块上边 0 |
| 正文 | 普通段落 | `--chijie-text-md` | 400 | `--chijie-paper-ink` | 段与段中等 |
| 列表项 | ul / ol | 同正文 | 400 | 同正文 | 项间距大于行缝；整表贴节名 |
| 句内加粗 | `**…**` 不占整行 | 继承 | 600 | 同正文 | 不另起块 |
| 来源层 | 「对核这些页」 | 12px 标题 / 11px host | 400 | `--chijie-muted` | 与正文组距大于来源组内 |

动效：`.chijie-answer` 入场 180ms 只改透明度。`prefers-reduced-motion` 已有全局短路。

不做：表格、代码块、引用、ChatGPT 级 h1、打字机、预印「结果」、把 `living/type` 衬线长文搬进侧栏。

## 思考过程

- 文案标题仍是 `chat_task_thinking_heading`（思考过程）。进度秒数在 Health，不写进思考标题。
- 进行中：展开，不能收。句子按真实 `pageReading` / 摘要拆开，每句 320ms 淡入。不要写死 `SENTENCES` / `DELAYS`。
- 做完（以及暂停）：默认收起。用户点标题再看。视口帽 180px，多了就滚。
- 不恢复无限扫光。

## 成功

- `parseAnswerBlocks` 把调研里那串 dump 拆出节名块，而不是把节名留在第一段里。
- 列表项里的 `**标签**：值` 仍是列表，不是节名。
- 失败任务不出现 `task-thinking-process`。
- 进行中思考 `open: true`；`completed` 时同一条思考 `open: false`。
- `WorkStream.tsx` 源码不含 `SENTENCES`、`DELAYS`。

## 命令

```bash
pnpm -F @extension/sidepanel test -- src/presentation/__tests__/answer-format.test.ts
pnpm -F @extension/sidepanel test -- src/presentation/__tests__/work-stream.test.ts
pnpm -F @extension/sidepanel test -- src/design/__tests__/ui-acceptance.test.ts
pnpm -F @extension/sidepanel test -- src/design/__tests__/ui-final-accessibility.test.ts
pnpm -F @extension/sidepanel test -- src/components/__tests__/task-status-card-identity.test.ts
```
