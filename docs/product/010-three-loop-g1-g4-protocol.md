---
title: "三层 Loop × G1–G4 × cmux 协议"
description: "吴恩达 Loop engineering 三层 + Matt 工程法 + cmux 四窗人格；持节复杂任务开发的编排合同。"
category: "product"
number: "010"
status: current
services: ["projects/chijie-browser"]
related: ["product/003", "product/008", "product/009", "product/004"]
last_modified: "2026-07-16"
---

# 010 — 三层 Loop × G1–G4 × cmux

## 一句话

复杂任务「束手无策」时，先封 **L1 内环**（规格 + evals + 预算），用四窗按环运转；不靠轶事式追问，不靠堆 UI。

**进环前置（硬）：** 无清晰指挥链 + 交付状态机 → **禁止**宣称进入 Loop Engineering。  
权威板：`docs/product/G-TEAM-LIVE.md` + `docs/product/G-TEAM-ROSTER.md`。

## 三层环（Ng Loop engineering）

| 层 | 节奏 | 驱动 | 产出 |
|----|------|------|------|
| **L1 Agentic 内环** | 分钟 | 冻结 **规格 + evals** 下的实现与自测/证伪 | 过线，或带失败类的停机 |
| **L2 Developer 中环** | 十几分钟～数小时 | 人的上下文优势：改愿景、压规格、补 evals | 新合同版本，回灌 L1 |
| **L3 External 外环** | 小时～天 | 真用户 / 真站 / Owner 早上验收 | 改方向与优先级，再进 L2 |

**硬规则：** Agent 能长时间干活，靠规格 + 可测条件把环封上。没有 stop 条件的任务不得宣称「复杂任务可托付」。

## Matt 工程法如何挂在环上

| Matt 动作 | 落在哪层 | 谁做 |
|-----------|----------|------|
| grill / 对齐语言 / 优先级 | L2 | G1 |
| to-spec（带测试缝）/ to-tickets 竖切 | L2 → 喂 L1 | G2 |
| implement + TDD | L1 | G3 |
| two-axis review（Standards + Spec）+ 跑测 | L1 → 回 L2 | G4 |
| handoff / 外环证据 | L3 | G1 编排，G4 留证据路径 |

共享语言仍以 lab 根 `CONTEXT.md` 与 `docs/product/003` 为准。

## G1–G4 名册（cmux workspace:9）

| 格 | Tab | surface（会变，以 `cmux tree` 为准） | 主环 | 写 | 禁 |
|----|-----|--------------------------------------|------|----|----|
| G1 主裁 Intent | G1·主裁 Intent | 左主 | L2（触 L3） | 问题句、优先级、进度一行、调度 | 大段业务码 |
| G2 规格 Spec | G2·规格 Spec | 邻 G1 | L2→L1 | contract + evals 字段 | 擅自实现 |
| G3 实现 Build | G3·实现 Build | | L1 | `projects/chijie-browser` 码+测 | 改合同、扩 scope |
| G4 证伪 Prove | G4·证伪 Prove | | L1→L2 | pass/fail、证据路径、失败类 | 顺手改完当交付 |

**禁止：** 触碰任何 **W\*** 前缀协作台（另一窗口的 FC-OPC 等）。

## cmux 原语

```bash
cmux tree --workspace workspace:9
cmux identify
cmux read-screen --surface surface:N --lines 80
cmux send --surface surface:N "…指令…\n"
```

- 编号每次以 `tree` 为准，不硬编码陈旧 surface。
- 跨窗真相在**盘上**，不在聊天记忆。
- 调度权默认在 G1。

## 一圈怎么转

```text
G1 钉问题（BDD：当我…应见…）
  → G2 冻结 contract-N-vX + evals（测试缝）
  → G3 只实现该版本 → commit 或可复现命令
  → G4 对照合同证伪 → pass/fail + 路径
  → G1 写进度一行：过则外环/下一竖切；不过则升合同版本或停
```

### Send 模板（G1 → G3）

> 只读绝对路径 `<contract>`。只做该版本验收项。回传：改动文件、测试命令与退出码、未做项。禁止扩 scope。

### Send 模板（G1 → G4）

> 只读 `<contract>` 与 G3 回传。对照 evals 跑测/审查。输出：PASS/FAIL、证据路径、失败类。禁止直接改实现冒充通过。

## 复杂任务 L1 封环最低字段

每份复杂任务相关合同至少含：

1. **目标句**（用户可见结果）
2. **完成 eval**（页面/结构化可观察证据；模型说 done 不算）
3. **步数预算** `maxSteps`（或等价）
4. **失败类**（含 `max_steps` / `no_progress` / `waiting_user` / 假完成红线）
5. **停机**（过线 | 失败类 | 等人；禁止无限空转）

## 验收（本协议是否生效）

| # | 当你… | 应看到… |
|---|--------|---------|
| 1 | 打开本文 | 三层 + G 职责 + cmux + 禁 W\* |
| 2 | 看 workspace:9 四格 | G1–G4 命名与身份 |
| 3 | 查最近竖切 | contract → 实现/命令 → G4 证据链在盘上 |
| 4 | 问「复杂任务下一步」 | 先封 L1，不是先要失败故事 |

## 进度回写位置

- 本文件末「Progress log」
- 或 lab `CONTEXT.md` 一行（短）
- 活跃 ship task 的 `control/run_state.yaml` notes（若竖切挂在该 task）

## Progress log

| 时间 (UTC) | 谁 | 内容 |
|------------|-----|------|
| 2026-07-16 | G1 | 协议落盘；验收目标 Owner 已同意（三层×四窗可跑 + 至少 1 轮闭环） |
| 2026-07-16 | G1→G2→G3→G4 | 竖切 010-v1 `no_progress` 封环：合同冻结 → 实现+10/10 测 → G4 PASS；证据 `reports/nanobrowser/2026-07-16-contract-010-l1-no-progress-g4.md`。G2–G4 终端曾空闲，L1 由 G1 按合同代跑；W* 未触。 |
