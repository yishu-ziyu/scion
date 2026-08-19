# 独立网址一次打开

日期：2026-08-19  
状态：已实现（合入工作区）  
依赖：`docs/specs/2026-08-19-verified-step-records.md`（加载完成后写入 URL、标题、摘句）。段记录若尚未合入，本实现仍须把每页的 `normalizedUrl` 与标题写进 `BrowserTargetRef`（`label` / 后续 `title` 字段），供下一轮模型和收工使用。

生产路径仍是 `createLlmControlDriver` + `runObserveActLoop`。不要请回规划器 / 导航器。不要逐步审批。后台打开，默认不把用户前台窗口抢过来（`TaskSession.followForeground` 为假时 `chrome.tabs.create({ active: false })`）。

## 场景

用户交两个已经写全的独立地址，例如：

`打开 https://www.iana.org 和 https://en.wikipedia.org/wiki/Web_browser，写出两个页面的标题`

现在：模型第一回合 `go_to_url` / `open_tab` 打开 A，再观察，再打开 B。付两次整页加载，中间夹一次模型调用。

要做成：识别出这两条 URL 互不依赖 → 一次动作里两个后台标签一起 `chrome.tabs.create` → `Promise.all` 等加载 → 各挂 `chrome.debugger`（`_attachAllowedPage`）→ 各写一条段记录 → 下一轮模型看见两条记录再写标题。

用户写了「先 A 再 B」或 `deriveInstructionUrlPlan.requiresOrderedSourceProof === true`：仍按现在一轮一个打开，不走并行。

## 目标

Hard bar：

1. 指令含两个以上字面 `https?://` URL，且 `requiresOrderedSourceProof` 为假：一次打开后，两个标签都存在、都已 attach、两条记录都有 `normalizedUrl` 和标题（非空、非 404）。测试里两次 `chrome.tabs.create` 都在任一次加载回调完成之前被调用。
2. 指令为「先打开 https://one.test/a 再打开 https://two.test/b」：不走并行打开；仍一轮一个标签。
3. `followForeground === false` 时，`chrome.tabs.create` 的 `active` 为 `false`。
4. 其中一页 `pageLooksUnavailable`：那一页不成交，另一页仍可写入；任务不因此直接失败。
5. `打开 YouTube 并点击第一个视频` 不走并行打开。

Improve：独立双 URL 任务从交出去到两条记录齐，中间的模型决定次数 → 1 次打开动作（不再为第二个网址再决定一次）。

搜索板第二条 Hard bar（同一 PR 能做就做，否则列为本规范未完成项，不要假装做了）：

6. 当前页是搜索结果（`isSearchResultsUrl`），且任务要打开多条结果：一次最多打开 `MAX_PARALLEL_TABS`（5）条 `AttemptFinding.url`，后台、同样写记录。超过 5 条下一轮再开。

## 非目标

- 不在同一 DOM 上并行点两个按钮。
- 不并行打三只模型做总结 / 问题 / 术语。
- 不一次打开几十个标签。
- 不把并行打开做成侧栏新栏目。工作流仍按发生的事列出两个「打开了…」。
- 不恢复 `Executor` 规划器 / 导航器。

## 怎么判断「可以并行」

用现成 `deriveInstructionUrlPlan(instruction)`。

| 条件 | 行为 |
|---|---|
| `sourceUrls.length >= 2` 且 `requiresOrderedSourceProof === false` | 并行打开尚未打开的 URL |
| `requiresOrderedSourceProof === true` | 不并行 |
| 某 URL 已是当前标签或已在 `targetRefs` 里 | 跳过，不重复开 |
| skill 短路径（`isAtomicSkillInstruction`） | 不并行 |

搜索结果路径：`isSearchResultsUrl(current)` 且指令需要多条来源 / 证据 / 「打开前 N 条」时，对 `normalizeSearchFindings` 里带 `url` 的项并行打开，上限 5。

## 实现落点

建议一个函数，例如 `BrowserContext.openIndependentTabs(urls: string[]): Promise<Page[]>`：

- 对每个 url 调 `chrome.tabs.create({ url, active: this._revealForeground, windowId })`
- `Promise.all` 等 `waitForTabEvents` + `_attachAllowedPage`
- 单页失败（不允许的 URL、attach 失败）记入结果，不把整批 abort 成任务失败
- 沿用 `isUrlAllowed`

谁调用：

- 控制循环在**第一次观察之前**，若计划可并行，先开再观察（避免模型用两回合各开一个）。
- 或 `TaskManager` 在 `start` 之后、`driver.run` 之前调用，经 `browserContext`。不要让模型必须新吐一个 `open_tabs` 才触发；模型不知道这一章。

打开完成后：对每个成功页读 URL、标题，写入段记录（规范 1）。然后 `runObserveActLoop` 照常；此时记录已在，模型下一轮应写结果而不是再 `go_to_url` 第二个站。

侧栏：每个成功打开仍是一条 `ActionAttempt`（`open_tab` / 等价），`targetUrl` 走 `persistableTargetUrl`。

## 测试

- 单元：`deriveInstructionUrlPlan` 可并行 vs 有序 已有；补 `openIndependentTabs` 对 mock `chrome.tabs.create` 的调用顺序（两次 create 都在第一次 load 完成前）。
- `followForeground` 为假时 `active: false`。
- 有序指令不调用 `openIndependentTabs`。
- 控制 / manager：双 URL 指令在第一次 `decide` 之前已经有两条 page targetRef（或段记录）。

跑：`pnpm -F chrome-extension exec vitest run src/background/browser src/background/task src/background/agent/backends`  
以及 `pnpm -F chrome-extension exec tsc --noEmit --pretty false`。

## 改哪些文件

- `chrome-extension/src/background/browser/context.ts` — `openIndependentTabs`
- `chrome-extension/src/background/browser/__tests__/context.test.ts`
- `chrome-extension/src/background/agent/backends/control-llm.ts` 和/或 `task/manager.ts` — 循环前触发
- 段记录写入点（与规范 1 同一套 `targetRefs`）
- 搜索路径若做：`search-results.ts` 的 finding urls + dispatcher / control-llm

## Key Decisions

1. 并行的是标签加载，不是多只模型。
2. 触发靠指令里的独立 URL 和代码，不靠模型新动作名。
3. 「先…再…」保持排队。
4. 单页 404 不成交，不拖垮整批。

## PR Plan

一个 PR：`openIndependentTabs` + 循环前触发 + 写入记录 + 测试。搜索板 5 条能在同一 PR 完成则完成；否则在 PR 说明里写未做，不要空实现。
