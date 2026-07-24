---
title: "持节任务 UX 原则（对标 Sider Claw，反泄漏）"
description: "页内操作条、人话步骤、可交付成果链接、停止与连续控制；学 Claw 结果即成，不学工具 log 文案。"
category: "design"
number: "005"
status: current
services: ["projects/chijie-browser/pages/side-panel", "projects/chijie-browser/chrome-extension"]
related:
  - "design/003"
  - "design/004"
  - "product/014"
  - "product/015"
  - "product/016"
  - "product/research/sider-claw/016-sider-claw-demo-catalog-and-ux"
  - "decisions/003"
last_modified: "2026-07-23"
---

# 005 — 持节任务 UX 原则（对标 Sider Claw）

## Status

**current（原则冻结；实现按里程碑渐进）。**

视觉三态与 token 仍以 [004](004-chijie-calm-task-console.md) 为准。  
本文补：**用户发要求之后** 侧栏 + 主窗口 + 完成物 必须满足的契约。  
对标证据：Sider Claw 落地页与 Amazon 演示帧（见 research 016）。

## Product intent

用户委托的是 **浏览器任务**。成功时他感到：

1. 我的目标还在  
2. 它在动，而且我看得见在干什么  
3. 页上真的变了  
4. 做完有东西可点开或可核对  
5. 危险一步会先问我  

不感到：调试台、内核角色名、假百分比。

---

## P1 — 任务发出之后的可见结构

固定信息架构（与 004 壳一致）：

```text
Header          唯一总状态（运行中 / 等待批准 / 已完成 / 失败…）
Task card       目标（最多三行可展）+ 当前站点 hostname
Live status     一行人话：正在读页 / 正在打开… / 正在核对…
Steps           最近约 3 步人话动作；更早折叠
Actions         暂停 · 停止（页面唯一停止）
Composer        固定底：补充或调整（follow-up 始终可输入）
```

运行中 **禁止** 锁死 composer。

---

## P2.1 — Activity 流（责任可见）

对标 Codex / Claw 的 **Activity** 区，不是调试日志：

```text
活动 · 45s
[👁] 正在查看 bilibili.com
[▶] 播放或暂停媒体 · 已核对
[🖱] 点击元素 · 执行中
```

| 要 | 不要 |
|----|------|
| 图标 = 通道类型（看/点/填/播/开页） | Planner / Navigator / tool schema |
| 计时 `活动 · Ns` | 假百分比进度条 |
| 一行 live + 可折叠操作记录 | Browser opened 过程 log 进聊天 |
| 站点 hostname 写进「正在查看」 | digest / 选择器 / 坐标 |

实现：`pages/side-panel/src/presentation/activity-stream.ts` + `TaskStatusCard` 的 `task-activity-panel`。

---

## P2 — 人话步骤（强制，反 presentation leakage）

### 允许出现在步骤行

| 模式 | 示例 |
|------|------|
| 动词 + 对象 | 打开页面、切换标签、关闭标签、点击、输入、滚动、等待 |
| 媒体 | 播放视频、暂停视频 |
| 抽取/整理 | 读取列表、整理成表格、保存摘录 |
| 结果向 | 写入表格、生成摘要、准备提交 |

### 禁止出现在主任务 UI（含步骤标题、状态行、完成正文）

- `Planner` / `Navigator` / `Browser:` / `Extract product 3` 式工具日志  
- `step_failed` / `observe_failed` / `no_progress` / `control_media` / digest / pageRevision  
- 后端名 `nano` / `control`、模型内部 tool schema  

映射层：`pages/side-panel/src/presentation/*` + i18n。  
**新动作上线必须先有人话 label**，不得 fallback 英文 actionName 进主 UI。

已知债：`close_tab` 不得与「切换标签」共用文案；须独立为「关闭标签」。

完整禁令见 [product/014 Part C](../product/014-executable-framework-axioms.md)。

---

## P3 — 页内「正在操作此页」（学 Claw 浮层，持节语气）

### 要

- 当 Agent 正在对 **某个内容标签** 执行会改变页面的动作时，在该页内容区底部或安全角显示 **一条冷静浮层**。  
- 文案默认（中文）：**正在替你操作此页**  
- 英文默认：`Working on this page`  
- 样式：低对比、不闪、不挡主 CTA；`prefers-reduced-motion` 下无动画。  
- 任务暂停 / 停止 / 完成 / 离开该 tab → **立即消失**。

### 不要

- 不显示工具名、step id、模型名。  
- 不做成会呼吸的整页遮罩。  
- 不在 `chrome://` / 扩展页 / PDF 查看器等非内容页强行注入（无注入则仅侧栏表达「运行中」）。

### 实现落点（建议）

- content script 轻量条 + background 按 `taskId`/`tabId` 开关  
- 与 Task 状态 `running` / `waiting_approval` 同步；`waiting_approval` 时改为更淡的 **等待你确认后继续** 或隐藏（二选一，默认 **隐藏**，批准卡在侧栏）

里程碑：M-UX-1 可先只做 running 条。

---

## P4 — 完成 = 可核对成果（学「结果即成」）

模型说 done 不够。完成区必须至少满足：

| 类型 | 用户可见 | 证据 |
|------|----------|------|
| 页状态任务 | 人话结果 + 回执 | URL / 媒体状态 / tab 已关 等 |
| 抽取/表格 | **可打开或可复制的成果** | 本地文件路径、下载项、或未来 Sheets 链接 |
| 需批准的提交 | 批准记录 + 页面成功态 | 批一次、0 假完成 |

### 完成卡最小结构

1. 状态：已完成（绿）  
2. 一句话结果（用户目标语言）  
3. **成果区**（有则显示）：链接 / 「已复制」/ 文件名  
4. 证据摘要（人话，1–3 条，非 raw digest）  
5. 次要：评分、存为技能  

无外部文件时，成果区可为「本页已暂停」「标签已关闭」等 **可观察结论**，不得留空只说「任务完成」。

---

## P5 — 停止、暂停、连续控制

| 控件 | 行为 |
|------|------|
| 停止 | 结束当前任务；不自动重开 |
| 暂停 | 可恢复；不丢目标与 target 绑定 |
| 底部输入 | 运行中 follow-up 新 Round；「停这个」类须绑同一媒体/页 |

连续控制 UX：follow-up 发出后，Live status 立即变为「已收到，继续…」类，避免像死机。

---

## P6 — 危险一步（与审批卡）

对外提交、发送、购买、删除、改权限：

- 侧栏 **等待批准** 卡优先于步骤噪音  
- 卡回答：做什么、对哪、影响、成功怎么看  
- 主按钮：批准并执行一次；目标变则旧批失效  

与 Claw O1/O3「提交前暂停」对齐，是卖点不是边角。

---

## P7 — 冷启动建议（可选，不挡主路径）

空闲态可给 2–4 条 **建议任务 chips**（本地/配置，非联网硬推）。  
点击填入 composer，不自动开跑，除非用户再确认发送。

---

## P8 — 与能力天花板 A→C

- 现在交付的 UX 必须在 **扩展 + 主 Chrome（能力 A）** 上成立。  
- 页内条、成果链接可随 companion 加深，但 **不得** 因未上 C 就省略「步骤可见 + 证据完成」。  
- 见 `decisions/003`。

---

## Acceptance (design)

| # | 检查 |
|---|------|
| A1 | 主路径无 Planner/step_failed/Browser: 工具 log |
| A2 | 运行中有人话 Live status + 最近步骤 + 可停 + 可补充 |
| A3 | 完成区有结果句；有成果时有可点/可复制入口 |
| A4 | 页内条仅在内容 tab 操作时出现，文案冷静 |
| A5 | 关闭标签步骤文案正确（非「切换」） |
| A6 | ui-acceptance / presentation 单测保持绿 |

## Out of scope here

- 30 例业务验收表 → [product/016](../product/016-sider-claw-parity-matrix.md)  
- 视觉 token 细调 → 004  
- 下载 DRM 策略 → product/014 + jarvis plan  
