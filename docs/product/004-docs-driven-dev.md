---
title: "文档驱动开发规范"
description: "用 product/decision/design 闸门驱动实现顺序、验收与换核；禁止无文档编号的顺手开发。"
category: "product"
number: "004"
status: current
services: ["projects/nanobrowser", "experiments/agent-core-bakeoff"]
related: ["product/001", "product/002", "product/003", "decisions/001", "decisions/002", "design/001"]
last_modified: "2026-07-15"
---

# 004 — 文档驱动开发规范

## 原则

1. **先文档、后代码。** 新能力必须能指到 PRD 条目 / 闸门 G# / 决策编号；不能指到则先补文档。
2. **一次只推进当前 M。** 见 `product/003`；`run_state.yaml` 的 `current_milestone` 是机器可读锚点。
3. **验收先于感觉。** 合并/宣称完成必须对照 G1–G8 或 PRD 验收表；无数字不写「已对齐 Tabbit」。
4. **质量优先。** `decisions/002`：该换核就换核，不保护 Nano Core 沉没成本。
5. **中等模型正式分。** 默认 MiniMax-M3；旗舰只调试。

## 文档角色

| 文档 | 回答的问题 | 改它的时机 |
|---|---|---|
| `003-north-star` | 做什么完？对齐谁？当前 M？ | 目标或标尺变了 |
| `001` PRD | 范围、流程、功能、非目标 | 产品范围变了 |
| `002` bake-off | 执行核怎么比？ | 候选核或协议变了 |
| `004` 本文 | 开发怎么服从文档？ | 协作纪律变了 |
| `decisions/*` | 永久边界 | 架构选型变了 |
| `design/*` | 怎么实现 | 实现方案定稿/换核后 |

## 开发循环（每个切片）

```text
读 003 当前 M + 相关 PRD 条目
  → 写/更新 plan 切片（.ship/tasks/.../plan/）若缺
  → 红线测试或 fixture 失败用例
  → 最小实现
  → 跑闸门相关命令，写 reports/
  → 对照 G# 更新 run_state / 003 进度锚点
  → 提交（conventional commits，不写 AI co-author）
```

### 允许的代码目录

| 阶段 | 主目录 | 说明 |
|---|---|---|
| M1 | `experiments/agent-core-bakeoff/p1-stagehand/` | 控制层 + 薄审批；不进默认 dist |
| M2 | `projects/nanobrowser/chrome-extension/src/background/agent/` | 多后端工厂 + control 环；见 `design/002` |
| M2+ | `projects/nanobrowser/` | 生产壳 + Task；换核适配器 |
| 报告 | `reports/nanobrowser/` | 矩阵与验收，git 可跟踪非密钥 |

### 命令锚点（M2）

```bash
cd projects/nanobrowser
pnpm -F chrome-extension test
# 关注：task/* journey + agent/backends/*
```

设计：`docs/design/002-production-core-swap.md`。

### 禁止

- 无 G# / PRD 编号的「重构一下 / 优化体验」。
- M1 未过就大规模改生产 Nano 环（安全热修除外，须标 G）。
- 把密钥写进文档或提交 `secrets.local` / `.env`。
- 用旗舰模型结果代替中等模型正式分。

## 命令锚点（M1）

```bash
cd experiments/agent-core-bakeoff/p1-stagehand
# 单次
AUTO_APPROVE=1 HEADLESS=true npm run fixture:form
HEADLESS=true npm run fixture:media
# 连续 10 次（矩阵）
AUTO_APPROVE=1 HEADLESS=true node scripts/run-matrix.mjs
```

证据目录：`reports/nanobrowser/bakeoff/`。

## 闸门 ↔ 实现映射（摘要）

| 闸门 | 实现落点（目标态） |
|---|---|
| G1 表单 10/10 | P1 harness → 生产 Action 风险门 + CompletionChecker |
| G2 媒体 10/10 | 站点无关 media 动作 + 目标 recency |
| G3/G4 ≥91.8% | 真实站固定协议 + Task/回执 |
| G5 中等模型 | MiniMax 适配；禁止 JSON 脆链无兜底 |
| G6 可换核 | Executor 适配器 seam；Stagehand/CDP 实现 |
| G7 隐私 | 脱敏存储；无 replay 键 |
| G8 Tabbit 声明 | 验收报告模板 |

## 完成一个 M 的定义

1. 对应 G 全部绿（数字在 `reports/`）。
2. `003` 进度锚点与 `run_state.yaml` 已更新。
3. 下一 M 在文档里写清，且**仅一条**默认下一会话任务。

## 与 yishuship

交付意图仍走 scion 仓内 `.ship/tasks/`；**产品对错以 `docs/product/*` 为准**，`.ship` 是执行过程，不是更高优先级需求源。
