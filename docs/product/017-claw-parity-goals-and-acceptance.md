---
title: "Claw 对标：目标冻结与验收门（可执行）"
description: "调研→目标→里程碑验收句；开发只对本文 when I do X I see Y 交差。M-80 定义与 016 一致。"
category: "product"
number: "017"
status: current
services: ["projects/chijie-browser"]
related:
  - "product/016"
  - "product/015"
  - "product/013"
  - "product/014"
  - "design/005"
  - "decisions/003"
last_modified: "2026-07-23"
---

# 017 — Claw 对标：目标冻结与验收门

## 一句话

**目标不是「做完 30 个功能」，而是同一可执行环能讲完 Claw 四类故事，且每道门有 when I do X → I see Y。**

输入：research + product/016 + design/005。  
输出：下面冻结的里程碑；未过门不得宣称该里程碑。

### Owner 强制（2026-07-23）

- **Sider Claw 落地页 30 个示例故事全部要跑分**（记分板：`product/018`）。  
- 禁止用「先抽几条 tracer 就够」替代全表；tracer 只是执行顺序，不是验收子集。  
- 跑不到 Claw 级用户可见终点 → 记 `partial`/`fail`，**不得**宣称对标完成。  
- **个性化 / 更深 Jarvis 叙事后置**：30 例记分板仍大面积 `not_run` 时，不得把主精力切走装忘记。

---

## 北极星（产品）

在用户日常 Chrome 里，用自然语言委托浏览器任务：

1. 步骤人话可见、可停、可补充  
2. 主窗口真操作（可选页内「正在操作此页」）  
3. 危险写操作提交前问一次  
4. 完成 = 可核对证据 + 有成果时能点开/复制  
5. 不泄漏内核调试符号  

对标故事全集：016。T0 探针句：015。

---

## 里程碑验收门（冻结）

### G-M0 — UX 壳（design/005）

| ID | when I do X | I see Y | 证据 |
|----|-------------|---------|------|
| M0-1 | 任务运行中看侧栏 | 目标 + 人话状态/步骤 + 停止 + 可输入补充 | UI 单测 + 真机 |
| M0-2 | 步骤含 close_tab | 文案「关闭标签」非「切换标签」 | ui-acceptance |
| M0-3 | 任务在内容页运行 | 页内冷静条「正在替你操作此页」；结束/暂停后消失 | 真机截图或 e2e |
| M0-4 | 任务 verified 完成 | 完成区有结果句 + 证据摘要；无 Planner/step_failed | UI + presentation |
| M0-5 | 主路径失败 | 人话原因，无工程码原文 | failure-taxonomy |

**G-M0 pass：** M0-1..5 均 pass（M0-3 允许先真机 checklist）。

**进度（2026-07-23）：** M0-2 pass（自动化）；M0-3/M0-4 代码 ready、真机 not-run；M0-1/M0-5 partial。详见 `.omo/notepads/claw-parity/progress.md`。

### G-M1 — Parity 环（015 T0）

| ID | 任务句（015） | verified_pass |
|----|---------------|---------------|
| M1-1 | J-CLOSE-01/02 关页 | 目标 tab 关闭 |
| M1-2 | J-PLAY / J-PAUSE | 媒体 playing/paused |
| M1-3 | J-CONT-01 连续控 | 同 digest 播→停 |
| M1-4 | 全过程 | wrong_tab=0, false_complete=0（n≥3/句） |

**G-M1 pass：** 上表 live 或 journey 等价绿 + 无假完成。

### G-M2 — Research 表

| ID | when I do X | I see Y |
|----|-------------|---------|
| M2-1 | 「把当前列表整理成表」类句 | 可打开 CSV/MD/表链接或可复制表格 |
| M2-2 | 多行可见字段 | 成果行数 ≥ 约定下限 |
| M2-3 | 完成 | 回执证据非口头 done |

映射故事：R1/R6/R7/R8 等。  
**G-M2 pass：** ≥1 条 ready 故事 + extract 路径有测。

### G-M3 — Operate-safe（O1）

| ID | when I do X | I see Y |
|----|-------------|---------|
| M3-1 | 填演示/表单任务 | 字段被填；**提交前**进入等待批准 |
| M3-2 | 未批准 | 0 次提交 |
| M3-3 | 批准一次 | 恰 1 次提交；成功态才 completed |

**G-M3 pass：** form-journey 或真机协议绿。

### G-M4 — Deliverable 文档/草稿

| ID | when I do X | I see Y |
|----|-------------|---------|
| M4-1 | 读页生成摘要/草稿 | 可复制正文或本地 MD 路径 |
| M4-2 | 完成区 | 成果入口可见 |

**G-M4 pass：** ≥1 条 T/G8 形态 ready。

### G-M5 — File pack（可选，不挡 80%）

PPT/PDF/Excel/音频 — 后置。

### G-M80

G-M0 ∩ G-M1 ∩ G-M2 ∩ G-M3 ∩ G-M4 均 pass + 013/015 TSR 闸（false_complete=0）。  
**不含 M5。**

---

## 开发顺序（只此一条）

```text
G-M0  UX 壳（页内条、完成成果、人话步骤债）
  → G-M1  T0 关页/播停 live
  → G-M3  O1 填表批准演示化（已有核，打磨验收）
  → G-M2  extract + 表成果
  → G-M4  摘要/草稿交付
  → （可选）G-M5
  → G-M80 宣称
```

并行允许：G-M1 live 与 G-M0 实现；G-M3 与 G-M2 在接缝不冲突时并行。  
禁止：先堆 M5 文件工厂；禁止未过 G-M0 宣称 Claw 体验。

---

## 工程计划索引

| 产出 | 路径 |
|------|------|
| 故事矩阵 | product/016 |
| UX 原则 | design/005 |
| 本验收门 | **product/017（本文）** |
| 执行 plan | `.omo/plans/claw-parity-dev.md` |
| 进度 notepad | `.omo/notepads/claw-parity/progress.md` |

每完成一门：更新 016 状态码 + 017 门旁 `pass/fail/not-run` + reports 路径。

---

## 非目标

- 复刻 Sider 云电脑 / 跨会话记忆 / Bash 出 PPT 作为 Phase 1  
- 破解 DRM  
- fork Chromium（decisions/001）  
