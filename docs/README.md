# scion 文档规范（开发驱动入口）

所有 **持节** 长程任务 Agent 的实现、验收、架构决策，**以本目录文档为准**。聊天记忆与临时方案不得覆盖本文。

工程卫生与 monorepo 入口：仓库根 [ENGINEERING.md](../ENGINEERING.md)、[README.md](../README.md)。  
上游 Nanobrowser 营销文归档： [upstream/nanobrowser/](upstream/nanobrowser/)。

## 阅读顺序（新人 / 新会话）

```text
1. product/021-long-horizon-task-agent.md ← 当前北极星：长程复杂任务 Agent
2. decisions/004-task-scoped-autonomy.md  ← 任务内自主执行，不再强制审批
3. product/011-browser-agent-parity-first.md ← 历史阶段纪律（旧方向）
4. product/003-north-star.md     ← 历史质量标尺（旧方向）
5. product/009-tabbit-gap-ledger.md ← Tabbit 历史差距台账
6. product/001-nanobrowser-prd.md ← 历史 PRD
7. decisions/001 + 002           ← 最终插件载体；质量优先可换核
8. product/002-agent-core-bakeoff.md ← 执行核对比（无 P0，主 P1）
9. design/001 + 002              ← 运行时 / 可换核（默认 control）
10. design/003 + 004              ← 侧栏 IA 源图 / 历史三态控制台
11. product/004-docs-driven-dev.md ← 如何用文档驱动开发
12. product/006-outer-loop-rl-min-plan.md ← 可选后续：外环 RL（draft，默认不执行）
13. product/020-eval-master.md ← 统一评估任务注册表与矩阵列
14. product/019-ai-agent-book-build-plan.md ← AI Agent Book 建设规划（current，默认路线）
```

> `product/003`、`product/011` 保留为旧方向历史文档；产品目标以 `product/021` 为准。

> 旧文档中仍出现 `waiting_approval` / 审批卡 / 外部提交批准等字样的段落，全部是 2026-08-02 之前的历史记录，不代表当前实现；当前实现只保留任务范围审计，不保留用户审批门。

索引表：`DOCS_INDEX.md`。

## 优先级（冲突时）

```text
Owner 当轮明确口头/文字纠正
  → product/021 北极星（长程任务 Agent）
  → product/001 PRD（范围与验收条目）
  → decisions/*（架构边界）
  → design/*（怎么实现）
  → .ship/tasks/*/plan/*（切片计划）
  → 代码现状
```

代码与文档冲突时：**先改代码对齐文档，或先改文档并写决策**；禁止 silently 按旧代码扩 scope。

## 当前里程碑

以 `product/021` 与
`.ship/tasks/plan-large-nanobrowser-second-development/control/run_state.yaml`  
中的 `current_milestone` 为准。

| 里程碑 | 状态 | 说明 |
|---|---|---|
| 旧 M1/M2 | 完成 | 浏览器行动基础；历史证据保留 |
| 旧 M3 | 历史阻塞 | 飞书+B 站不再作为当前北极星 |
| **L1 长程任务** | **进行中** | Mission/Plan、长上下文、自主执行、可验证交付 |

**下一会话默认：** 实现长程上下文压缩与中断恢复，再接长程任务评估集。

> `product/019` 已验收为 current：下一会话默认改为 Wave 1（评估与可观测性地基）；`product/020` 是其任务输入契约。
