# scion 文档规范（开发驱动入口）

所有 **持节** 浏览器行动 Agent 的实现、验收、换核，**以本目录文档为准**。聊天记忆与临时方案不得覆盖本文。

工程卫生与 monorepo 入口：仓库根 [ENGINEERING.md](../ENGINEERING.md)、[README.md](../README.md)。  
上游 Nanobrowser 营销文归档： [upstream/nanobrowser/](upstream/nanobrowser/)。

## 阅读顺序（新人 / 新会话）

```text
1. product/011-browser-agent-parity-first.md ← 阶段纪律：先对标可靠操作，再记忆差异
2. product/003-north-star.md     ← 终局质量标尺 + 闸门 G1–G8（阶段以 011 为准）
3. product/009-tabbit-gap-ledger.md ← Tabbit 全产品差距、缩差顺序与当前第一项
4. product/001-nanobrowser-prd.md ← 产品范围、流程、功能需求
5. product/008-tabbit-class-agent-task-loop-spec.md ← 当前 MVP 任务环索引（tickets 01–05）
6. decisions/001 + 002           ← 最终插件载体；质量优先可换核
7. product/002-agent-core-bakeoff.md ← 执行核对比（无 P0，主 P1）
8. design/001 + 002              ← 运行时 / 可换核（默认 control）
9. design/003 + 004              ← 侧栏 IA 源图 / 安静任务控制台视觉与三态
10. product/004-docs-driven-dev.md ← 如何用文档驱动开发
11. product/006-outer-loop-rl-min-plan.md ← 可选后续：外环 RL（draft，默认不执行）
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
| M1 | **完成** | G1+G2 fixture 10/10；`bakeoff/2026-07-14-m1-*` |
| M2 | **完成** | G6 可换核；默认 `control`；`design/002` current |
| **M3** | **进行中 / 等 Owner** | 飞书+B 站；协议 `product/005` |
| M4–M5 | 未开始 | Skill/隐私抽检 + G8 填数 |

**下一会话默认：** 只推进 M3（需 Owner 登录态）；无登录时不要假装 G3/G4 绿。
