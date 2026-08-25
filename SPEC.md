# Spec: Live work stream（进行中的侧栏必须长出已经发生的事）

本文只覆盖：任务 `status === 'running'` 时，侧栏 `WorkStream` 画什么。
不覆盖：评分、预印「目标 / 现在 / 结果」、仅聊天/执行闸门、模型 token 流、默认把截图塞进流。

产品是这个 Agent。侧栏是这次工作的窗口。Tabbit 十张图是参考对象，不是规格。

## Assumptions（先按这些写；不对就改）

1. 「流式」= `runObserveActLoop` 每走完 observe / decide / act 一次，侧栏多一块能核对的东西。当模型还在吐字，侧栏不必一个 token 一个 token 刷新。
2. 模型 JSON 的 `observation`（还没做完时的短读页）要进流：跟在已经出现的搜索板 / 页卡后面。空句、「思考中」、「获取页面快照」丢掉。
3. 用户已经停在 Google 搜索结果上、没有再调 `search_google`：当页是搜索结果 URL，则仍画搜索板（查询词 + 条目标题），不画两遍 host。
4. `click_element` / `input_text` 各自占一行，不并进上一张页卡。`external_commit` 仍走提交提示。
5. 默认不抢前台。底部「接管」保留。
6. 测试与验收有松/严两条时，选更严、能复用的那条。

## Objective

使用者派一句要在页上做的任务，并看着侧栏。
当 Agent 在搜、点、开、填时，侧栏必须出现可指认的对象（查询词、第 4 条标题、读页的一句人话、点击行、新页标题），让人知道 Agent 存在并且在干活。
目标用户：仓库主人；发布后是自己填模型密钥的人。
成功：下面 Success Criteria 每一条都能用现有测试命令证伪。

## Tech Stack

- 侧栏：`pages/side-panel/src/presentation/work-stream.ts` 的 `deriveWorkStream`，`components/WorkStream.tsx` 画块
- 任务快照：`TaskRound.attempts`（`ActionAttempt`）+ `TaskRound.pageReading`
- 循环：`runObserveActLoop`；生产驱动 `createLlmControlDriver`
- 搜索条目标题：`collectSearchFindings`（`browser/search-results.ts`）
- 人话动作行：`buildAttemptDisplaySummary`（`task/attempt-display.ts`）

## Commands

```bash
pnpm -F @extension/sidepanel test -- src/presentation/__tests__/work-stream.test.ts
pnpm -F @extension/sidepanel test -- src/components/__tests__/task-status-card-identity.test.ts
pnpm -F chrome-extension test -- src/background/task/__tests__/loop-phase-attempt.test.ts
pnpm -F chrome-extension test -- src/background/task/__tests__/attempt-display.test.ts
pnpm -F chrome-extension test -- src/background/task/__tests__/manager.test.ts
pnpm -F @extension/sidepanel test -- src/design/__tests__/ui-acceptance.test.ts
pnpm type-check
```

## Project Structure

```text
pages/side-panel/src/presentation/work-stream.ts     从 attempts + pageReading 推出块
pages/side-panel/src/components/WorkStream.tsx       搜索板 / 页卡 / 动作行 / 读页句 / 接管
pages/side-panel/src/components/TaskStatusCard.tsx   把 round 传给 deriveWorkStream
packages/storage/lib/task/types.ts                   TaskRound.pageReading
chrome-extension/src/background/task/loop-phase-attempt.ts  observe 补上 findings / 搜索：
chrome-extension/src/background/task/manager.ts      reportLoopPhase 写入 snapshot
chrome-extension/src/background/agent/backends/control-llm.ts  看完 SERP、decide 后上报
```

## Code Style

块类型用已有的 `search` / `page` / `commit` / `thinking`，点击与填写新增 `act`。
不要新造中文块名类型。用户看见的字来自 `displaySummary`、搜索 `findings[].title`、`pageReading`。

```typescript
// 当 click_element 不是 external_commit，则单独一块 act，不改上一张页卡
if (attempt.actionName === 'click_element' && attempt.effect !== 'external_commit') {
  blocks.push({ type: 'act', id: attempt.id, text: attempt.displaySummary, live });
}
```

## Testing Strategy

- 纯函数：`deriveWorkStream` 用用户那条 Google 场景钉死（已在 SERP、第 4 条、读页句、点击行）
- `attemptsAfterLoopPhase`：observe 补 findings；decide 的人话写入 `pageReading`
- `TaskStatusCard` 静态 HTML：出现条目标题和读页句，不出现「获取页面快照」
- 不做扩展级 e2e 作为本 spec 门槛（侧栏块从 snapshot 派生；snapshot 对了，画就对了）

## Boundaries

- Always: 进行中的流只画已经发生或正在发生的对象；噪声句丢掉
- Ask first: 把截图默认塞进流、改「接管」语义
- Never: 预印空的目标/计划槽；评分；把 `observe` 的「获取页面快照」画成一步

## Agent 函数（当…则…）

当 `status === 'running'` 且当前页是搜索结果 URL（`isSearchResultsUrl`），则侧栏出现搜索板：查询词来自 `搜索：` 摘要或地址栏 `q=`，条目标题来自 `findings`。
当 `collectSearchFindings` 读到标题，则 `reportLoopPhase` 把 `findings` 写到当前 `observe` 的 `ActionAttempt`，且 `displaySummary` 为 `搜索：{query}`。
当 `HIDDEN_ACTIONS` 碰到 `observe`，若该 attempt 已是搜索（`isSearchAttempt`），则仍画搜索板。
当模型 `observation` 经 `isHumanPageReading` 为真，则写入 `TaskRound.pageReading`，`deriveWorkStream` 在已有块后面出 `thinking`（文案用那句人话；折叠标题仍是「思考过程」）。
当 `click_element` / `input_text` / `control_media` 且不是 `external_commit`，且 `attempt.state` 不是 `blocked`，则出现 `act` 行，字为 `displaySummary`（优先控件可见文本）。
当动作没发生（`attempt.state === 'blocked'`），则不出现 `act` / `commit` 行；绑定询问由恢复区的选项卡画，不由流里先冒一条假点击。
当点击导致新页并写入 `targetRefs.title`，且该 URL 还不在流里，则补一张页卡，标题用 `document.title`，host 与 title 相同则只留一行。
当 `status === 'running'` 且还没有任何 search / page / act / commit 块，则至少根据绑定页画出搜索板或页卡，禁止只剩 `live-cursor`。
当任务完成，则过程折进「查看过程」；本 spec 不改交付句。

## Success Criteria

1. 已在 `https://www.google.com.hk/search?q=全部`（或等价 Google `/search`）上，attempts 只有带 `findings` 的 `observe`：`deriveWorkStream` 的块含 `search`，`queries[0].query` 含查询词，`results` 含第 4 条标题；没有 host 当标题叠两遍的页卡。
2. 同一快照再加 `pageReading: '当前是搜索结果页，第四条是某某教程'`：其后出现 `thinking`，文案就是这句；`获取页面快照` / `思考中` 作 `pageReading` 时不出现 thinking。
3. 再加 `click_element`（非提交）`displaySummary: '点击第四个：某某教程'`：其后出现 `type: 'act'`，文案为该摘要。
4. `TaskStatusCard` 对上述 running snapshot 的 HTML 含第 4 条标题、读页句、点击行、`data-testid="live-cursor"`、接管；不含「获取页面快照」。
5. `reportLoopPhase({ phase: 'observe', findings, detail: '搜索：全部' })` 后，当前 live `observe` attempt 带上 `findings` 与该 `displaySummary`。
6. `reportLoopPhase({ phase: 'decide', detail: '当前是搜索结果页，第四条是某某教程' })` 后，`TaskRound.pageReading` 等于该句。
7. `buildAttemptDisplaySummary({ actionName: 'click_element', effectTarget: { text: '某某教程' } })` 得到含「某某教程」的点击行。
8. 一条 `click_element` `state: 'blocked'`：`deriveWorkStream` 不含该 `act`；同一快照里 `observed` 的真实点击仍出现。

## Open Questions

无。`observation` 进流已选定（选项 1）。
