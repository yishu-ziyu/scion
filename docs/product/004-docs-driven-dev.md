---
title: "文档驱动开发规范"
description: "用 product/decision/design 闸门驱动实现顺序、验收与换核；禁止无文档编号的顺手开发。"
category: "product"
number: "004"
status: current
services: ["projects/chijie-browser", "experiments/agent-core-bakeoff"]
related: ["product/021", "product/019", "product/020", "decisions/001", "decisions/002", "decisions/004"]
last_modified: "2026-08-11"
---

# 004 — 文档驱动开发规范

## 原则

1. **先文档、后代码。** 新能力必须能指到 021 条目 / 019 wave / 闸门 G# / 决策编号；不能指到则先补文档。
2. **一次只推进当前 M。** 见 `product/021`；`run_state.yaml` 的 `current_milestone` 是机器可读锚点（不得与 021 冲突）。
3. **验收先于感觉。** 合并/宣称完成必须对照 020 评估协议与页面证据；无证据不写「已对齐」。
4. **质量优先。** `decisions/002`：该换核就换核，不保护 Nano Core 沉没成本。
5. **中等模型正式分。** 默认 MiniMax-M3；旗舰只调试。
6. **冲突时谁赢。** `021` → `decisions/004` → `020` → `019` → `run_state`；历史 003/011/016–018 永不覆盖。

## 文档角色

| 文档 | 回答的问题 | 改它的时机 |
|---|---|---|
| `021` 北极星 | 做什么完？长程任务 Agent？ | 产品目标变了 |
| `decisions/004` | 任务内是否自主？ | 审批/授权策略变了 |
| `020` eval master | 跑什么任务、怎样算过？ | 任务注册表变了 |
| `019` roadmap | Harness 建设顺序？ | 路线 wave 变了 |
| `004` 本文 | 开发怎么服从文档？ | 协作纪律变了 |
| `decisions/*` | 永久边界 | 架构选型变了 |
| `design/*` | 怎么实现 | 实现方案定稿/换核后 |
| `003` / `011` / `018` 等 | 历史方向（只读） | 仅归档修正，不升 current |

## 开发循环（每个切片）

```text
读 021 当前目标 + run_state current_milestone + 相关 019/020 条目
  → 写/更新 plan 切片（.ship/tasks/.../plan/）若缺
  → 红线测试或 fixture 失败用例
  → 最小实现
  → 跑闸门相关命令，写 reports/
  → 对照闸门更新 run_state（不得与 021/004 冲突）
  → 提交（conventional commits，不写 AI co-author）
```

### 允许的代码目录

| 阶段 | 主目录 | 说明 |
|---|---|---|
| 扩展主路径 | `projects/chijie-browser/` | 唯一交付树；默认核 `control` |
| bake-off 实验 | `experiments/agent-core-bakeoff/` | 非默认 dist；质量优先可换核证据 |
| 证据 | `reports/` | 不进产品身份 |

## 禁止

- 无编号顺手开发「看起来相关」的功能。
- 把历史 003/011/018 当 current 北极星。
- 恢复默认逐步审批以对抗 `decisions/004`。
- 用模型 `done` 宣称完成而无页面证据。
