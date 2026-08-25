# Spec: 绑定等待的两处残留

日期：2026-08-24
产品：持节侧栏。
根目录 `SPEC.md` 仍只覆盖进行中的 WorkStream；本文不替换那份。
绑定选项卡的主规格仍是 `docs/specs/2026-08-24-wait-ask-card.md`。
本文只写上次留下的两处，以及怎么改。

参考不是规格：aicss Approval Card。
「两个国家下拉」「先出现一条被挡住的点击」只是例子，用来钉死原理，禁止按这两个文案硬编码。

## Assumptions（不对就改）

1. 原生下拉 = 页面上的 `<select>`。`select_dropdown_option` 和 `get_dropdown_options` 只作用于这种控件。自定义 div 菜单仍走 `click_element`。
2. 两个都叫「国家」的 `<select>`：查询「国家」绑到编号控件时不唯一，且两边都有可见名字（`text` / `label` / `placeholder`），则出同一张等待卡。不是列出 `<option>` 里的中国/美国。
3. `get_dropdown_options` 也必须走同一条绑定。只给 `select_dropdown_option` 加 query、读选项仍用猜的编号，等于没改。
4. 工作流不画 `attempt.state === 'blocked'` 的动作行。blocked 表示动作没发生。不只针对绑定询问，也不只针对点击。
5. blocked 的 `ActionAttempt` 仍写在 round 上，供核对。只是 `deriveWorkStream` 不把它画成 `act` / `commit`。
6. 不改接管。不预印目标 / 现在 / 结果。不把审批变回主路径。

→ 这六条有错现在说。

## Capability Map

两条能分开验收，互不为存在条件，可并行。

| Module id | Responsibility | Depends on |
|---|---|---|
| bind-select | `select_dropdown_option` / `get_dropdown_options` 走 `resolveControlIndex`，模糊时出 `waitAsk` | — |
| stream-blocked | `deriveWorkStream` 不把未发生的 blocked 动作画成点击/填写行 | — |

Build order: 可并行。`bind-select` 先做则两个「国家」能出卡，但选的那次仍可能先冒一条 blocked 行，直到 `stream-blocked` 也绿。

## Objective

使用者派一句要在页上做的任务。
Agent 把这句话绑到当前页已编号控件时，点、填、选只要走 `resolveIntent`，规则相同：唯一则做；多个同分带名字则停在 `waiting_user`，侧栏出观察得来的名字；没有可见名字则不编选项。
侧栏进行中的流只画已经发生或正在发生的事。没点下去的动作不能先冒成一条点击记录，再叠一张选项卡。

目标用户：仓库主人。
成功：下面 Success Criteria 每一条都能用现有测试命令证伪。

## Tech Stack

- 绑定：`resolveIntent` / `waitAskFromAmbiguousBind` / `ActionBuilder.resolveControlIndex`
- 选：`selectDropdownOptionActionSchema`、`getDropdownOptionsActionSchema`（`chrome-extension/src/background/agent/actions/schemas.ts`）
- 流：`deriveWorkStream`（`pages/side-panel/src/presentation/work-stream.ts`）
- 卡：已有 `deriveWaitAsk` + `TaskStatusCard`，本残留不新造卡
- 控制模型看的动作表是 ActionBuilder 的 zod schema，不是 `packages/schema-utils/lib/json_schema.ts`

## Commands

```bash
pnpm -F chrome-extension test -- src/background/agent/actions/__tests__/click-query.test.ts
pnpm -F chrome-extension test -- src/background/browser/kernel/__tests__/resolve-intent.test.ts
pnpm -F @extension/sidepanel test -- src/presentation/__tests__/work-stream.test.ts
pnpm -F @extension/sidepanel test -- src/components/__tests__/task-status-card-identity.test.ts
pnpm -F chrome-extension type-check
pnpm -F @extension/sidepanel type-check
```

## Project Structure

```text
chrome-extension/src/background/agent/actions/schemas.ts     select / get_dropdown 的 query 与 index 二选一
chrome-extension/src/background/agent/actions/builder.ts     两条动作先 resolveControlIndex
chrome-extension/src/background/agent/actions/__tests__/     选的查询测，可放在 click-query 或并列文件
pages/side-panel/src/presentation/work-stream.ts             blocked 不画 act/commit
pages/side-panel/src/presentation/__tests__/work-stream.test.ts
docs/specs/2026-08-24-wait-ask-card.md                       绑定卡主规格
SPEC.md                                                      只补 WorkStream：blocked 不画
```

## Code Style

绑定只经过已有的 `resolveControlIndex`。
不要为「国家」写站点规则，不要为「点击记录」写第二个等待卡。

```typescript
const resolved = await this.resolveControlIndex(input);
if (!resolved.ok) {
  return new ActionResult({
    error: resolved.error,
    waitAsk: resolved.waitAsk,
    includeInMemory: true,
    success: false,
    isDone: false,
  });
}
```

```typescript
if (attempt.state === 'blocked') {
  i += 1;
  continue;
}
```

`select_dropdown_option` 仍要 `text`（要选中的那条 option 文案）。
模糊的是哪一个 `<select>`，不是 option 列表。

## Testing Strategy

缝只有两条，都已存在：

1. `resolveControlIndex`：`select_dropdown_option` / `get_dropdown_options` 带 `query` 时，与 `click_element` / `input_text` 同一返回（唯一执行；多个带名字则 `target_ambiguous` + `waitAsk`，页面不变）。
2. `deriveWorkStream`：`state === 'blocked'` 的 `click_element` / `input_text` / `select_dropdown_option` / `control_media` 不出现 `act` 或 `commit`；`observed` 的真实点击仍出现。

测试级别：单元。不做扩展 e2e 作为本 spec 门槛。

## Boundaries

- Always: 选项名字来自这一轮观察；点选项仍是 `follow_up` 且按 execute 接上；根目录 `SPEC.md` 不被整篇替换
- Ask first: 把原生 `<select>` 的 option 列表也做成等待卡；改接管
- Never: 硬编码「国家」或「点这个位置」；给自定义下拉菜单假装 `select_dropdown_option`；因为没点成功就删掉 `ActionAttempt`

## Module: bind-select

当 `select_dropdown_option` 或 `get_dropdown_options` 带查询字，则先 `resolveControlIndex`。
当查询绑上 ≥2 个同分且带名字的控件，则不改页面，返回 `target_ambiguous` 与 `waitAsk`。
当唯一绑上，则用解析到的编号继续原来的选/读。
当只给编号、不给查询，则行为与现在相同。
当查询绑上的不是 `<select>`，则仍走现有「不是 select」错误，不出假选项。

成功：

- 两个 `<select>`，可见名字「账单国家」「收货国家」，`select_dropdown_option { query: "国家", text: "中国" }`：不调用 `page.selectDropdownOption`；`waitAsk` 的 `sendText` 为那两个名字。
- 同一页只有一个「国家」：照常选中 `text`。
- `get_dropdown_options { query: "国家" }` 在两个「国家」上同样停住并给出 `waitAsk`。
- `click_element { query: "提交" }` 原路径不变。

## Module: stream-blocked

当 `deriveWorkStream` 走到 `click_element` / `input_text` / `control_media` / `select_dropdown_option` / `send_keys`，且 `attempt.state === 'blocked'`，则不推 `act`，也不推 `commit`。
当同一 attempt 是 `observed` 或仍在 `executing`，则仍按现有规则画。
当 round 同时有 `waitAsk`，恢复区仍画选项卡（`TaskStatusCard`，不是 WorkStream 块）。

成功：

- snapshot：`waiting_user` + `waitAsk` 两个「Submit」+ 一条 `click_element` `state: 'blocked'` `displaySummary: '点击 Submit'`：`deriveWorkStream` 的块不含该 `act`；`TaskStatusCard` HTML 含两个名字和「自己写」。
- 同一流再加一条 `observed` 的 `click_element` `displaySummary: '点击第四个：某某教程'`：该 `act` 仍在。
- `status === 'running'` 且点击正在 `executing`：`act` 仍在，`live: true`。

## Open Questions

无。option 列表是否也弹卡：Never，除非另开规格。
