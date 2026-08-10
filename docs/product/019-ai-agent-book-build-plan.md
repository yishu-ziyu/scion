---
title: "AI Agent Book 驱动的持节建设规划"
description: "把《深入理解 AI Agent》的生产级 Harness 方法论落到持节：先补评估与可观测性地基，再跑证据，最后再谈进化。"
category: "product"
number: "019"
status: current
services: ["docs", "projects/chijie-browser"]
related:
  - "product/003"
  - "product/011"
  - "product/012"
  - "product/013"
  - "product/014"
  - "product/015"
  - "product/016"
  - "product/017"
  - "product/018"
  - "product/006"
  - "design/002"
  - "design/007"
last_modified: "2026-08-11"
---

# 019 — AI Agent Book 驱动的持节建设规划

## 状态

**current，Owner 已验收。** 产品北极星是 `product/021`（长程任务 Agent），**不是**旧 M3 飞书/B 站黄金旅程。
执行状态以 `run_state.yaml` 的 `current_milestone: long_horizon_v1` 为准；本文描述 Harness / Eval / Observability / Outer Loop 建设路线。

## 执行状态

| Wave | 状态 | 证据 |
|---|---|---|
| Wave 0 | 完成 | 019 current、020 eval master、run_state 已登记 |
| Wave 1 | 完成 | `task/trace.ts`、`scripts/eval-matrix.mjs`、`scripts/eval-model-swap.mjs`；矩阵报告 `reports/nanobrowser/eval/` |
| Wave 2 | 完成 | 状态栏、prompt 版本化、ACI、特性开关、重试策略、上下文压缩；2026-08-06 单测与 type-check 全绿 |
| Wave 3 | 部分→加强 | 2026-08-06 formal batch MiniMax-M3 **10/10 verified_pass**（含 `021-LH-01..03`）；真站长尾仍待跑 |
| Wave 4 | 阻塞 | Owner 日常 Chrome 登录态；协议仍为 product/005；**历史黄金旅程，非 021 北极星** |
| Wave 5 | 进行中 | `scripts/outer-loop.mjs` 已跑；Skill candidates 已落盘 `reports/nanobrowser/outer-rl/skills/candidates/`；真实站轨迹待补 |

## 目的

《深入理解 AI Agent：设计原理与工程实践》给出的不是一张功能清单，而是一条从 Demo 到生产 Agent 的建设路径：

> Agent = LLM + 上下文 + 工具
> 生产 Agent = Model + Harness
> Harness = Context + Tools + Constrain + Verify + Correct
> 长期可靠 = Evaluation + Observability + Continuous Evolution

本规划把这条路径映射到 `持节 / Chijie`，先回答“一个 Agent 产品要能被可靠造出来，必须具备哪些部分”，再对照现状，最后给出新的建设顺序。

## 1. 书本定义的产品必需部件

### 1.1 Model：决策内核

- Agent 任务需要支持多步推理、工具选择、动态决策，正式分必须绑定中等模型。
- 模型不是固定资产；必须通过**模型替换实验**区分“模型能力不足”和“Harness 设计缺陷”。

### 1.2 Context：Agent 能看到什么

- 上下文 = 静态系统提示 + 工具定义 + 动态轨迹 + 用户记忆 + 外部知识。
- 生产级上下文工程需要：确定性渲染、渐进式披露、Agent 状态栏、上下文压缩、隐私保护。
- 状态栏必须由**代码确定性维护**，不能交给 LLM 统计，否则状态错误会直接污染决策。

### 1.3 Tools：Agent 能做什么

- 工具是 ACI，不是普通 API：命名直观、参数有例子、边界明确、返回值结构清晰。
- 工具粒度要少而稳，用有限原语组合复杂能力。
- 参数传递必须保真：模型看到的世界和工具操作的世界不能有系统性偏差。
- 外部提交、不可逆操作必须分级、可审计；持节按 `decisions/004` 做任务级授权，不恢复逐步审批门。

### 1.4 Loop：Observe → Reason → Act → Re-observe

- 每一步之后必须重新观察真实页面状态。
- 需要明确停止条件、最大步数、无进展检测、失败分类。
- 模型口头 `done` 不是完成，只有环境证据才能裁决完成。

### 1.5 Constrain：行为边界

- 默认 fail-closed；高风险操作显式开放。
- 任务目标范围内的外部提交直接执行并打审计标签；超范围高风险才说明；敏感输入拒绝自动填写。
- 输入侧、执行侧、输出侧都要有护栏。

### 1.6 Verify：自动判断对错

- 验证对象是“模型 + Harness”，不是模型本身。
- 需要结构化页面状态检查：URL、DOM、媒体状态、tab 状态、下载状态、表单结果。
- `false_complete` 是产品事故，不是普通失败。

### 1.7 Correct：错误恢复

- 先分类，再计数，再决定是否重试；不能“出错就重试”。
- 可重试错误：网络、限流、超时。不可重试错误：参数非法、权限不足、目标不存在。
- 需要无进展检测、重复调用指纹、熔断器、人工升级、全局终止条件。

### 1.8 Evaluation：可复现证据

- 评估环境包含：数据集、环境状态、工具接口、评分标准、执行协议。
- 任务集需要明确性、真实性、可控性、层次化、防泄漏。
- 指标至少包含 TSR、Pass@k / Pass^k、失败分类、延迟、成本。
- 统计显著性：分差小于噪声带宽时不做切换决策。

### 1.9 Observability：可诊断性

- 一次任务 = 一条 trace；每个 LLM 调用、工具调用、观察、验证都是一个 span。
- 必须记录输入、输出、耗时、token、成本、错误、决策轨迹。
- 生产轨迹脱敏后回流成评估集和回归用例。

### 1.10 Internal Evaluation Infrastructure

- 每个主要特性应可独立关闭，做消融实验。
- 提示词必须可确定性渲染、版本化、可回归。
- 特性开关是一等公民，用于实验、渐进发布、熔断。
- 隐私感知的分析从第一天设计，不能事后补。

### 1.11 Continuous Evolution

- 从运行轨迹中提取学习信号，更新知识、指令、程序或参数。
- 只有评估和验证可靠之后，才允许经验回流。
- 当前阶段不做模型训练；可做“外环学习”：轨迹 -> Skill / 策略 -> 回归。

## 2. 持节现状盘点

### 2.1 已经具备的部分

| 书本部件 | 持节现状 | 证据 |
|---|---|---|
| Harness 壳 | TaskManager / ActionDispatcher / CompletionChecker / 回执 | `design/002`、`task/manager.ts` |
| 可换执行核 | `control` 默认，`nano` 可拔 | `design/002`、`agent/factory.ts` |
| 观察帧 | Snapshot Frame、`pageRevision`、stale frame reject | `design/007`、`task/action-frame.ts` |
| 约束 | 任务内自主执行（无默认审批门）、外部提交留审计标签、隐私抽检 | `product/021`、`decisions/004`、`services/guardrails` |
| 验证 | URL / page_text / media_state / tab_state / download_state criteria | `control-policy.ts`、`task/completion.ts` |
| 纠正 | `no_progress`、`maxFailures`、失败分类、可恢复重试 | `backends/observe-act-loop.ts`、`control-llm.ts` |
| 产品 UX | 人话步骤、停止、完成证据、反展示泄漏 | `product/014`、`design/005` |
| 评估文档 | 013 固定任务集、015 冻结验收句、016/017/018 Claw 30 | `product/013/015/016/017/018` |

### 2.2 当前证据缺口

| 缺口 | 现状 | 问题 |
|---|---|---|
| 自动化评估环境 | 只有手动 CSV + e2e 片段 | 无法重复 reset、批量跑分、前后对比 |
| 模型替换实验 | 只有 MiniMax-M3 部分矩阵 | 无法区分模型瓶颈和 Harness 瓶颈 |
| 结构化可观测性 | 只有 logger / PostHog 粗事件 | 无法回放每个观察、动作、验证、耗时、成本 |
| Agent 状态栏 | 未实现 | 长任务中模型需要自己数步骤、记状态 |
| 上下文压缩 | 未实现 | 长轨迹会腐化、超限、成本上升 |
| 工具 ACI | schema 已有，描述缺少例子和边界 | 工具选错根因大概率在描述 |
| 提示词版本化 | prompt 是静态常量 | 无法知道哪个 commit 改了什么行为 |
| 消融/特性开关 | 未实现 | 无法验证每个特性真实贡献 |
| 持续进化闭环 | `product/006` 只是 draft | 没有轨迹回流、Skill 候选、回归 |
| Claw 30 证据 | 1 pass / 1 partial / 28 not_run | 不能宣称对标完成 |

## 3. 差距对照表

| 书本要求 | 持节现有 | 持节缺什么 | 本规划动作 |
|---|---|---|---|
| Model | MiniMax-M3 正式模型 | 无同 Harness model swap | W1 模型替换实验 |
| Context | 观察摘要 + criteria | 无状态栏、无压缩、无确定性 prompt 版本 | W2 上下文工程 |
| Tools | 约 20 个 action schema | ACI 描述弱、无示例、无成本/边界说明 | W2 工具 ACI |
| Loop | observe-act-loop 已落地 | 失败恢复映射不完整 | W2 错误分类表 |
| Constrain | 任务级自主 + external_commit 审计标签 + guardrails | 消融开关持续完善 | W2 特性开关 |
| Verify | CompletionChecker + 页面证据 | 无统一 eval verifier 层 | W1 eval harness |
| Correct | no_progress + maxFailures | 无错误到恢复策略映射表 | W2 retry taxonomy |
| Evaluation | 013/015/016/017/018 文档 | 无自动化 runner、无统计报告 | W1 eval harness |
| Observability | logger + PostHog | 无 trace span、无回放 | W1 observability |
| Evolution | 006 current；outer-loop 已跑 | Skill 候选需筛选与真站扩跑 | W5 外环学习 |

## 4. 新建设顺序

### Wave 0 — 规划冻结

目标：Owner 接受本文档，锁定“先评估和可观测性地基，再跑证据，再谈进化”。

交付物：

1. 本文档从 draft 转 current。
2. `DOCS_INDEX.md` 登记 019。
3. 将 013、015、016、017、018 合成一张评估主表，明确 task_id 的唯一入口。

闸门：Owner 确认；不写产品功能代码。

### Wave 1 — 评估与可观测性地基

目标：让每次改动都能在同一固定任务集上产生可复现报告。

交付物：

1. `scripts/eval/` 自动化 runner：fixture reset、任务调度、证据校验、CSV/MD 报告。
2. Trace 协议：每个任务输出一条 trace，包含观察、决策、动作、结果、耗时、模型调用、token 估算、失败分类。
3. 隐私红线：trace 落盘前脱敏，不存表单值、Cookie、页面正文、完整 prompt。
4. Model swap 脚本：同一 Harness、同一任务集，跑 MiniMax-M3 + 一个更弱/更强模型。
5. 基线报告：013 mini-set 或 015 T0 作为首个可复现基线。

闸门：

- 自动跑 013 mini-set，生成矩阵和 summary。
- `false_complete=0`、`wrong_tab=0`。
- 每次跑分可写出 git sha、model、attach_mode、prompt version、failure_class。

### Wave 2 — Harness 完整性

目标：补齐书本定义的 Context / Tools / Correct / Constrain 生产部件。

交付物：

1. Agent 状态栏：由代码维护 URL、title、pageRevision、步骤数、失败数、criteria、等待状态、最近证据。
2. 工具 ACI：为每个 action 写“何时用、何时不用、参数例子、返回值、代价、边界”。
3. Prompt 版本化：prompt 纯函数渲染，带 `PROMPT_VERSION`，变更必须跑回归。
4. 特性开关：编译时/运行时双开关，支持消融，例如关闭状态栏、关闭确定性捷径、关闭重试。
5. 错误恢复映射表：错误 -> 是否重试 -> 恢复策略 -> 熔断阈值 -> 人工升级。
6. 最小上下文压缩：工具输出先结构化摘要，长轨迹再触发归档式压缩。

闸门：

- 每个改动先跑 Wave 1 基线，再跑实验组。
- 单变量实验；成功率不降才合并。
- prompt / tool / policy 均有版本号。

### Wave 3 — 固定任务集证据

目标：把 013、015、T0 与长程迷你集（`021-LH-*`）从“文档”变成可复现证据。
Claw 30（016/017/018）仅为**历史评测资产**，可按需补跑，**不是**本 wave 或 021 的北极星闸门。

顺序：

1. 013 A 组理解绑定 -> B 组行动闭环 -> C 组任务范围安全（决策 004：范围内自主；超范围高风险说明；敏感输入拒绝）-> D 组恢复负例。
2. 015 J 组关页、播停、连续控制、抓取、下载。
3. 021-LH 长程迷你集回归；可选补跑 018 历史故事行（不阻塞 `long_horizon_v1`）。

方法：

- 先跑完整基线，不做代码修改。
- 从失败簇定位：看不清、点不到、绑错页、卡住、验不过。
- 每轮只改一个变量，用 Wave 1 报告判断是否保留。

闸门：

- 正式分使用 MiniMax-M3。
- `false_complete=0`、`wrong_tab=0`。
- 任务范围外的高风险外部提交不得静默成功（按 decision 004；**不是**逐步“未批提交”门）。

### Wave 4 — 历史黄金旅程（旧 M3 / G3 / G4 / G8；非 021 北极星）

目标：在 Wave 1–3 证据充足后，可选跑飞书与 B 站真实黄金旅程。
**不**把本 wave 升为产品北极星；当前里程碑仍是 `long_horizon_v1`（见 `product/021` + `run_state`）。

前置：

- Owner 提供日常 Chrome 登录态。
- `product/005` 从 draft 转为可执行协议。

交付物：

- G3 飞书矩阵：任务目标范围内自动提交一次，页面成功证据（任务级授权，无默认逐步审批卡）。
- G4 B 站矩阵：同一媒体 digest 播 -> 停 -> paused 证据。
- G8 Tabbit 对齐表：附 n、模型、分母、失败分类（质量参考，非北极星）。

### Wave 5 — 外环进化

目标：在 Phase 1 可靠后，把轨迹变成可复用 Skill 和策略。

交付物：

1. 启用 `product/006` 外环 RL 阶段 A：回归基线 + 策略对比。
2. Skill 候选池：只收 `R >= 9`、无假完成、无敏感字段的轨迹。
3. 每个 Skill 必须换输入重跑 ≥3 次。

闸门：

- Wave 1–3 已产生稳定基线。
- 没有把旗舰模型计入正式成功率。
- Memory 产品仍不实现，只保留接口。

## 5. 决策纪律

1. 任何实现都必须能指到 G#、Milestone 或本文档 Wave。
2. 每次实验只改一个变量。
3. 前后对比必须同一任务集、同一模型、同一 attach_mode。
4. 正式成功率只用 MiniMax-M3；旗舰只用于 debug / judge。
5. 没有页面证据不得报 completed。
6. 不提前做 Memory、知识图谱、多 Agent 平台、MCP 堆叠。
7. 不把 Claw 30 / 018 重新升为产品北极星；宣称 Claw 对标完成仍须有表内证据（历史评测纪律）。

## 6. 验收本规划

**已验收为 current（2026-08-02+）。** 文首 Wave 执行状态表为准；本节历史验收问题仅作记录。

当前下一会话默认（与 `run_state` 一致）：

- `current_milestone: long_horizon_v1`
- `next_default: long_horizon_eval_harden_and_outer_loop`
- 北极星：`product/021`；自主：`decisions/004`
- Wave 0–2 已完成；Wave 3 部分加强；Wave 4 历史黄金旅程阻塞于 Owner 登录；Wave 5 已有 candidates（`outer_rl_status: candidates_generated`）

Owner 当时验收的三点（已发生，勿再当作“下一会话从 Wave 1 开工”指令）：

1. 同意“先建评估和可观测性地基，再跑证据”。
2. 同意“Wave 1 先建基础设施”。
3. 旧 M3 黄金旅程可保持 blocked；**不得**把 next_default 读回 “从 Wave 1 开始”。

## 7. 非目标

- 不写完整的 Agent 平台。
- 不训模型权重。
- 不实现 Phase 2 记忆产品。
- 不为了 30 条故事做 30 个专用硬编码功能。
- 不跳过评估直接宣称 Tabbit 对齐。

## 8. 书本源码锚点

| 方法论 | 本地书源码 |
|---|---|
| Harness 五要素 | `book/chapter1.md` |
| Agent 状态栏 / 上下文压缩 | `book/chapter2.md` |
| 工具 ACI / MCP / 主动发现 | `book/chapter4.md` |
| Coding Agent Harness / 错误恢复 | `book/chapter5.md` |
| 评估 / 可观测性 / 内部评估基础设施 | `book/chapter6.md` |
| 外环进化 | `book/chapter8.md` |
| Computer Use 动作空间与 Grounding | `book/chapter9.md` |
| Harness 与模型共同演进 | `book/afterword.md` |
