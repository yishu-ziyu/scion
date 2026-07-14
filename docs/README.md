# scion 文档规范（开发驱动入口）

所有浏览器行动 Agent 的实现、验收、换核，**以本目录文档为准**。聊天记忆与临时方案不得覆盖本文。

## 阅读顺序（新人 / 新会话）

```text
1. product/003-north-star.md     ← 唯一最终目标 + 闸门 G1–G8 + 当前里程碑 M*
2. product/001-nanobrowser-prd.md ← 产品范围、流程、功能需求
3. decisions/001 + 002           ← 扩展载体；质量优先可换核
4. product/002-agent-core-bakeoff.md ← 执行核对比（无 P0，主 P1）
5. design/001-...                ← 运行时设计（换核前后会改 status）
6. product/004-docs-driven-dev.md ← 本文配套：如何用文档驱动开发
```

索引表：`DOCS_INDEX.md`。

## 优先级（冲突时）

```text
Owner 当轮明确口头/文字纠正
  → product/003 北极星（目标与闸门）
  → product/001 PRD（范围与验收条目）
  → decisions/*（架构边界）
  → design/*（怎么实现）
  → .ship/tasks/*/plan/*（切片计划）
  → 代码现状
```

代码与文档冲突时：**先改代码对齐文档，或先改文档并写决策**；禁止 silently 按旧代码扩 scope。

## 当前里程碑

以 `product/003` 文末与  
`.ship/tasks/plan-large-nanobrowser-second-development/control/run_state.yaml`  
中的 `current_milestone` 为准。

| 里程碑 | 状态 | 说明 |
|---|---|---|
| M1 | **完成** | G1+G2 fixture 10/10（MiniMax-M3）；证据 `reports/nanobrowser/bakeoff/2026-07-14-m1-*` |
| **M2** | **进行中** | 生产换核：`design/002` + ExecutorDriver 多后端；Nano 可拔 |
| M3+ | 未开始 | 飞书/B 站 ≥91.8% 等 |

**下一会话默认：** 只推进 M2（不要开 G3/G4）。
