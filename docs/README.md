# scion 文档规范（开发驱动入口）

所有 **持节** 长程任务 Agent 的实现、验收、架构决策，**以本目录文档为准**。聊天记忆与临时方案不得覆盖本文。

工程卫生与 monorepo 入口：仓库根 [ENGINEERING.md](../ENGINEERING.md)、[README.md](../README.md)、[AGENTS.md](../AGENTS.md)。
上游 Nanobrowser 营销文归档： [upstream/nanobrowser/](upstream/nanobrowser/)。

## 事实源优先级（冲突时谁赢）

```text
Owner 当轮明确纠正
  → product/021 北极星（长程任务 Agent）
  → decisions/004 任务级自主（无默认审批门）
  → product/020 评估协议与 task_id 注册表
  → product/019 Harness / Eval / Observability / Outer Loop 路线
  → run_state.yaml（只记真实执行状态，不得与上冲突）
  → design/*（实现方案）
  → 代码现状
```

**历史文档永不覆盖 current 文档。**
`product/003`、`011`、`016`、`017`、`018` 及旧审批 UX 描述仅作历史/评测资产。

> 旧文档中仍出现 `waiting_approval` / 审批卡 / 外部提交批准等字样的段落，全部是 2026-08-02 之前的历史记录，不代表当前实现；当前实现是任务范围授权 + 停止/修正，不是逐步审批。

代码与文档冲突时：**先改代码对齐 current 文档，或先改文档并写决策**；禁止 silently 按旧代码扩 scope。

索引表：`DOCS_INDEX.md`。

## 阅读顺序（新人 / 新会话）

```text
1. product/021-long-horizon-task-agent.md     ← 当前北极星
2. decisions/004-task-scoped-autonomy.md      ← 任务内自主
3. product/020-eval-master.md                 ← 评估契约 / task_id
4. product/019-ai-agent-book-build-plan.md    ← 建设路线（Harness 等）
5. decisions/001 + 002                        ← 插件载体；质量优先可换核
6. design/002 + design/007                    ← 默认 control 核；Snapshot Frame
7. product/004-docs-driven-dev.md             ← 文档如何驱动开发
8. product/006-outer-loop-rl-min-plan.md      ← 外环学习（已有 runner + 候选）
9. product/022-adaptive-browser-harness-v1.md ← product_status=proposed；Kernel/Skill/Artifact 已 default_enabled（见 022 §0）
--- historical only (do not treat as north star) ---
10. product/003 / 011 / 016 / 017 / 018
11. design/001 / 003 / 004 / 005 / 006（旧侧栏与审批叙事）
```

## 当前里程碑

以 `product/021` 与
`.ship/tasks/plan-large-nanobrowser-second-development/control/run_state.yaml`
中的 `current_milestone` 为准（必须一致）。

| 里程碑 | 状态 | 说明 |
|---|---|---|
| 旧 M1/M2 | 完成 | 浏览器行动基础；历史证据保留 |
| 旧 M3（飞书+B 站黄金旅程） | 历史阻塞 / Owner 登录 | 不再作为当前产品北极星 |
| **long_horizon_v1** | **进行中（核心部件已落）** | Mission/Plan、任务级自主、长上下文压缩、长程评估迷你集 |
| Outer-loop Skill candidates | **已跑** | `reports/nanobrowser/outer-rl/skills/candidates/` |
| **022 Harness** | product **proposed**；实现 **部分 default_enabled** | Kernel/Skill/Artifact 默认开；Diff/Learned 关；Release Gate 未全过 |

**下一会话默认：** 见 `run_state.yaml` 的 `next_default`（harden 长程 eval + 继续外环候选质量，不恢复 Claw-30 北极星叙事）。

> `product/022`：**product_status=proposed**（整包未过 Release Gate）。
> **implementation：** `enableBrowserKernelV1` / `enableSkillRuntime` / `enableArtifactVerification` 默认 **true** 且进入 control 生产路径；`enableObservationDiff` / `enableLearnedSkills` 默认 **false**。
> 禁止写「022 尚未进入默认路径」——与 `DEFAULT_EVAL_SETTINGS` 冲突。详情见 `022` §0。
