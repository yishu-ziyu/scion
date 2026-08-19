# 单章报告格式（必须按此写）

文件名：`chNN.md`（附录用 `appendix.md`）。只写这一份，不改产品代码。

```markdown
# 第 N 章：<中文书名>（<English chapter title>）

## 书里的机制
用自己的话写 5–8 条。每条后面用括号标书文件里能搜到的原句片段。

## 结论
- 做成 / 部分做成 / 没做成
- 完成度：<0-100 整数>
- 一句话：完成度为什么是这个数（必须点到具体函数或「搜过但没有」）

## 对照表

| 书中机制 | 持节路径与符号 | present / partial / absent | 用户能看见什么 |
|---|---|---|---|
| … | 至少 4 行 | | |

## 对持节业务的意义
持节业务 = 用户把页面上的事交出去，侧栏按发生的事往下长，交出能核对的结果。
写 3–6 句：这一章的机制会改变哪一次用户操作、哪一张侧栏、哪一次失败。

## 完成方案
若完成度 < 90：
- Goal:
- Hard bar:（when I do X, I see Y）
- 改哪些现有文件（不要新开第二套 agent 树）
- 非目标:
若 ≥ 90：写「不改」和一句理由。

## 证据
- 书：读过的文件路径
- 代码：用过的搜索词和命中路径
- 明确的未命中：搜了什么、在哪些目录没有
```

## 持节主路径（不要误判）

生产默认：`createExecutorDriver` → `createLlmControlDriver`（`PERSONAL_AGENT_CORE_BACKEND = control`）。
循环：`runObserveActLoop`（`observe-act-loop.ts`）。
任务：`TaskManager.dispatch`。用户那一句的分类在 `classifyStartOrFollowUp`（`decideUserTurn` / `resolveUserTurnCheap`），不在侧栏。
`planner.ts` / `navigator.ts` 是旧路径。只有 `factory.ts` 实际调用时才能算做成。
侧栏：`pages/side-panel/src/SidePanel.tsx`。不要把未接线的组件算做成。

## 语言

指到文件、函数、Chrome API、用户能看见的句子。不要用身体比喻，不要发明新架构外号。
书的章节名是该书官方名称，可以原样用。
