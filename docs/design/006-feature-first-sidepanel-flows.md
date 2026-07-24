---
title: "持节侧栏 Feature-First 流程（映射现有组件）"
description: "从既有功能出发：Goal → Flow → UI 节点 → Atomic 层；不写绿场视觉重做。服务 Claw 30 记分板门，个性化后置。"
category: "design"
number: "006"
status: current
services: ["projects/chijie-browser/pages/side-panel"]
related:
  - "design/003"
  - "design/004"
  - "design/005"
  - "product/016"
  - "product/017"
  - "product/018"
last_modified: "2026-07-23"
---

# 006 — 持节侧栏 Feature-First 流程

## Status

**current（流程映射；不启动视觉绿场）。**

- 视觉与三态 token 仍以 [004](004-chijie-calm-task-console.md) 为准。
- 任务发出后的人话/成果/页内条契约以 [005](005-chijie-task-ux-from-claw.md) 为准。
- 产品门以 [018](../product/018-claw-30-live-scorecard.md) 全表为准；**个性化工作不得抢在 Claw 30 之前。**
- 本文只整理 **已有侧栏能力** 的 Goal / Flow / 节点 / 原子，并标出相对 **M0 + O1** 的缺口。
- 代码落点：`pages/side-panel`（`SidePanel.tsx`、`TaskStatusCard.tsx`、`design/chijie-*.css`）。

## Doctrine（写 UI 时的顺序）

1. **FEATURE 先于 layout。** 先问用户要完成什么，再谈区块位置。
2. **Goal → Flow → UI 节点 → Atomic。** 不从栅格或配色开写。
3. **映射现有 `chijie-*` 组件。** 禁止另起一套视觉语言。
4. **Claw 30 记分是门。** UI 改动优先服务 `when I do X → I see Y`，不服务装饰。

---

## 1. Feature → Goal + Trigger + Success

只列侧栏 **已有** 能力（含 partial 实现）。不发明新产品面。

| Feature | Goal（用户要什么） | Trigger | Success（可观察） | 主节点 |
|---------|-------------------|---------|-------------------|--------|
| 委托任务 | 用自然语言让扩展在网页上做事 | 底部 composer 发送；或收藏/Skill 填入后发送 | 出现任务卡；Header/卡上状态变为运行中或等待 | `chijie-composer` → `TaskCommand.start` → `chijie-paper-card` |
| 绑定当前页 | 任务作用在「现在这页」 | 打开侧栏；切换 tab | 绑定芯片显示 hostname（或明确缺失） | `chijie-bind-chip` |
| 看见进度 | 知道它在干什么、在哪 | 任务 `running` | 目标 + 站点 + 人话 live 行 + 最近步骤；无内核 log | `chijie-task-goal`、`chijie-activity-panel`、`chijie-activity-stream` |
| 暂停 / 恢复 | 暂时停手，稍后继续同一目标 | 点暂停 / 恢复 | 状态变为 paused / 再 running；目标与 target 不丢 | `chijie-task-controls` + pause/resume |
| 停止任务 | 彻底结束当前任务 | 卡内「停止」 | 任务 terminal；不自动重开 | `chijie-btn-danger`（页面唯一停止） |
| 连续补充 | 运行中改指令或下一步 | running 时 composer 再发 | 新 Round；旧结果可折叠摘要；live 立即有反应 | follow_up → 新 Round 主面 |
| 提交前批准 | 危险写操作只批一次再提交 | `waiting_approval` | 审批卡在步骤之上；未批 0 提交；批后恰 1 次 | `chijie-approval-card` |
| 拒绝后改 | 不批，回去改目标或页 | 点「不批准」 | 回 waiting/可输入；旧批失效 | reject + composer |
| 等待用户 | 登录/验证码/目标丢失等 | `waiting_user` + waitReason | 人话提示 + 主按钮（继续/确认） | `chijie-next-step`、wait affordance |
| 验证完成 | 完成可核对，不是模型口头 done | receipt + evidence 齐 | 结果句 + 证据列表 + 可折叠回执 | `chijie-done-block`、`chijie-evidence-list` |
| 部分完成 | 知道做了什么、还缺什么 | coverage partial | 已做/缺失分区；非绿色全完成 | `chijie-done-block.is-partial`、`chijie-coverage-block` |
| 评分 | 轻量反馈是否符合预期 | verified 完成 | 三选一 radio；不改 receipt | `chijie-rating-control` |
| 存为 Skill | 把成功配方留下重跑 | 完成态「保存为 Skill」 | 表单 → ack 后关闭；收藏可再跑 | `chijie-skill-save-row`、`chijie-bookmarks` |
| 冷启动建议 | 空闲时快速填一句任务 | 无消息 + 有收藏 | chips 填入 composer，不自动开跑 | `chijie-bookmarks` / BookmarkList |
| 未配置模型 | 先能配模型再委托 | 无模型 | 欢迎卡 + 打开设置 | `chijie-welcome` |
| 失败可读 | 失败后知道原因与下一步 | `failed` / 人话 taxonomy | 产品失败文案，无 raw category 默认暴露 | `chijie-next-step` + failure-taxonomy |

**明确不做（本轮 / 门前）：** 个性化推荐、第二大脑画布、聊天机器人闲聊主面、新视觉体系。

---

## 2. Top 3 User Flows（含失败态）

### Flow A — 委托并看见它在干活（M0 主环）

**Goal：** 发出任务后立刻感到「目标还在、它在动、我能停」。

```text
空闲 / 绑定芯片
  → 输入目标 → 发送
  → 任务卡出现（目标 + 站点）
  → Activity live + 最近步骤
  → （可选）暂停 / 停止 / 底部补充
```

| 节点 | 用户问题 | 现有 UI |
|------|----------|---------|
| 绑定 | 作用在哪一页？ | `chijie-bind-chip` |
| 发送 | 怎么开始？ | `chijie-composer` + ChatInput |
| 目标 | 我托的是什么？ | `chijie-task-goal` |
| 活着 | 现在在干什么？ | `chijie-activity-live` |
| 步骤 | 刚做了什么？ | `chijie-activity-stream`（默认近 3 步） |
| 控制 | 我怎么停？ | `chijie-task-controls` |

**成功：** M0-1：目标 + 人话状态/步骤 + 停止 + 可补充。

**失败 / 边缘：**

| 场景 | 用户应看到 | 不得看到 |
|------|------------|----------|
| 未绑 tab / 特殊页 | 绑定缺失文案；可继续尝试 | 假装在操作某站 |
| 长时间无新 attempt | `仍在工作 · Ns` 或诚实卡住；可停 | 假百分比、假满格 |
| 失败 | 人话原因 + 下一步 | `step_failed` / Planner / 原始 failureCategory |
| 中断 | interrupted 提示；继续前会重观察 | 静默当完成 |

---

### Flow B — 表单：填完 → 提交前停 → 批一次（O1 / G-M3）

**Goal：** 字段真填上；未批不提交；批后只提交一次；成功才 completed。

```text
委托填表
  → running：人话步骤（输入/点击）
  → waiting_approval：审批卡置顶
  → 批准并提交一次 或 不批准
  → executing → evidence
  → verified 完成 或 结果不确定
```

| 节点 | 用户问题 | 现有 UI |
|------|----------|---------|
| 审批卡 | 做什么、对哪、影响？ | `chijie-approval-card` + details |
| 主 CTA | 怎么只批一次？ | `chijie-btn-primary`（approve） |
| 拒绝 | 怎么改？ | secondary reject + composer |
| 完成 | 提交成功了吗？ | `chijie-done-block` + evidence |

**成功（018 O1）：** 字段已填；未批 0 提交；批 1 次提交；用户可见终点对齐 Claw 演示站（现仅为 form-journey `auto_proxy`）。

**失败 / 边缘：**

| 场景 | 用户应看到 | 行为约束 |
|------|------------|----------|
| 目标/按钮变了 | 旧批失效；重新等待批准 | 0 自动提交 |
| `commit_outcome_uncertain` | 可能已提交，不自动重试；显式消解 | 无普通「再提交」 |
| 双击批准 | 按钮 pending/disabled | 不二次 commit |
| 模型英文 boilerplate 摘要 | 结构化本地文案兜底 | 不直接展示英文 template |

---

### Flow C — 完成可核对 + 轻量后续（M0-4 / 成果）

**Goal：** 完成区回答「做完了什么、证据在哪、有没有可点成果」。

```text
verifying
  → receipt + evidence 齐 → 已验证完成
  → 结果句 + 证据 1–3 条
  → （有则）成果入口
  → 可选评分 / 存 Skill
  → composer：继续下一步（新 Round）
```

| 节点 | 用户问题 | 现有 UI |
|------|----------|---------|
| 结论 | 完成了什么？ | `chijie-done-block` 标题/正文 |
| 证据 | 凭什么算完？ | `chijie-evidence-list` |
| 回执 | 细节？ | `chijie-receipt-details`（默认折叠） |
| 成果 | 文件/复制在哪？ | `completion-deliverable`（有则显示） |
| 部分完成 | 还差什么？ | `chijie-coverage-block` |
| 后续 | 还能干嘛？ | rating / skill / composer |

**成功：** 结果句 + 证据；有成果时有可点/可复制入口；无 presentation leakage。

**失败 / 边缘：**

| 场景 | 用户应看到 | 不得 |
|------|------------|------|
| 模型说 done、证据不足 | 结果待验证 / 还缺证据 | 绿完成、评分、存 Skill |
| 无外部文件 | 可观察结论（如「本页已暂停」） | 空完成只说「任务完成」 |
| partial coverage | 已做/缺失列表 | 伪装全绿 |

---

## 3. Atomic inventory（绑现有 class）

层级：Shell → Molecule 区 → Atom 控件。全部已在 `chijie-components.css` / `contracts.ts`。

### Shell

| Atomic | Class / 落点 | 职责 |
|--------|--------------|------|
| 壳 | `chijie-shell` | 全栏背景与字体 |
| Header | `header` + `chijie-header-brand` | 品牌；总状态宜唯一（见 004） |
| 工作区 | `chijie-workspace` | 任务卡 + 聊天区纵向 flex |
| 聊天滚动 | `chijie-chat-log` | 消息；任务卡之上/旁的阅读面 |
| 底栏 | `chijie-composer` | 固定连续控制；`data-task-active` |
| 欢迎 | `chijie-welcome` / `chijie-welcome-card` | 未配模型 |

### Task card molecules

| Atomic | Class | 职责 |
|--------|-------|------|
| 任务卡 | `chijie-paper-card`（`taskCardClassName`） | 主任务面；`data-status` / `data-coverage` |
| 头行 | `chijie-task-head` | 状态 pill + 站点 chip |
| 状态 pill | `chijie-task-status-pill` | 运行/批准/完成/失败色 |
| 站点 | `chijie-task-site-chip` | hostname · 短标题 |
| 目标 | `chijie-task-goal` / `-text` / `-toggle` | 目标最多三行可展 |
| 策略提示 | `chijie-policy-hint` | 琥珀提示 |
| Activity | `chijie-activity-panel` | 计时 + live + 历史 |
| Live 行 | `chijie-activity-live` | 当前人话动作 |
| 步骤流 | `chijie-activity-stream` / `chijie-round-*` | 折叠步骤列表 |
| 审批 | `chijie-approval-card` | 提交前确认 |
| 完成 | `chijie-done-block` | 验证完成 / partial |
| 覆盖 | `chijie-coverage-block` | 已做 / 缺失 |
| 证据 | `chijie-evidence-list` | 1–3 条人话证据 |
| 回执 | `chijie-receipt-details` | 折叠元数据 |
| 评分 | `chijie-rating-control` | 三档 radio |
| Skill | `chijie-skill-save-row` | 次级保存 |
| 下一步/失败 | `chijie-next-step` | 等待与失败说明 |
| 控制栈 | `chijie-action-stack` / `chijie-task-controls` | 暂停/恢复/停止 |

### Controls & inputs

| Atomic | Class | 用途 |
|--------|-------|------|
| 主按钮 | `chijie-btn-primary` | 批准、恢复、发送、Skill 确认 |
| 次按钮 | `chijie-btn-secondary` | 拒绝、暂停、取消编辑 |
| 危险 | `chijie-btn-danger` | 停止任务 |
| 字段 | `chijie-field` | Skill 标题/模板 |
| 绑定芯片 | `chijie-bind-chip` | 当前 tab |
| 收藏 | `chijie-bookmarks` | 冷启动 / Skill 入口 |
| Mono 标签 | `chijie-mono-label` | 分区小标题 |

### Presentation（非 class，但属同一原子层）

| 模块 | 路径 | 职责 |
|------|------|------|
| Activity 文案 | `presentation/activity-stream.ts` | 图标通道 + live 句 |
| 步骤/完成 predicate | `presentation/task-loop-ui.ts` | 是否展示步骤/完成/评分 |
| 失败人话 | `presentation/failure-taxonomy.ts` | 工程码 → 产品句 |
| 完成结论 | `presentation/completion-outcome.ts` | 证据约束结果句 |
| 目标覆盖 | `presentation/goal-coverage.ts` | partial 分区 |
| 等待 affordance | `presentation/wait-affordance.ts` | wait 主按钮选型 |
| 绑定 | `presentation/active-tab-bind.ts` | bind chip 数据 |

**规则：** 新 UI 文案必须进 `presentation/*` + i18n；不得把 actionName / failureCategory 原文塞进主路径。

---

## 4. Gaps vs Claw O1 / M0

对照 [017 G-M0 / G-M3](../product/017-claw-parity-goals-and-acceptance.md) 与 [018](../product/018-claw-30-live-scorecard.md)（2026-07-23：30 例 0 pass，O1 仅 auto_proxy）。

| 门 | 要求 | 侧栏现状 | Gap（设计/产品可见） |
|----|------|----------|----------------------|
| M0-1 | 运行中：目标 + 人话步骤 + 停 + 可补充 | 卡结构基本齐；composer 可 follow-up | 真机长任务下 live 与 Claw「一步一看见」仍可能偏弱；Header/卡状态勿重复抢注意 |
| M0-2 | close_tab =「关闭标签」 | 映射已有 | 回归守住即可 |
| M0-3 | 页内「正在替你操作此页」 | 005 已定；侧栏外 content 条 | **侧栏无法单独过门**；缺真机消失时机验收 |
| M0-4 | 完成句 + 证据；无泄漏 | `chijie-done-block` + evidence 有 | **成果链接**（CSV/MD/复制）多数故事仍空；018 全 not_run |
| M0-5 | 失败人话 | taxonomy 有 | 部分路径仍可能露出过细码；主路径须默认产品句 |
| O1 / G-M3 | 填表 → 提交前停 → 批 1 次 | 审批卡 + form-journey proxy | **缺 Claw 演示站真机**；Activity 步骤文案要对齐「填字段 / 提交前停」叙事，而非工具 log |
| O1 演示感 | 步骤像人操作清单 | displaySummary + humanActionLabel | 摘要质量依赖执行核；空摘要时退回粗标签，演示弱于 Claw |
| 018 纪律 | 全 30 记分；个性化后置 | 侧栏壳可支撑记分 | **UI 迭代不得改道做个性化壳** |

**非 gap（不要改）：** 浅色任务台、纸质卡、品牌绿/琥珀/危险色分工、固定底 composer、禁止 confetti/假进度。

---

## 5. 最多 5 条具体 UI diff（按目标影响排序）

只改现有节点密度与文案契约，不重做 layout 体系。

| # | Diff | 服务 Goal | 落点 | 验收 |
|---|------|-----------|------|------|
| 1 | **审批卡信息优先于步骤噪音**（已有结构则加固）：waiting_approval 时折叠步骤默认收、审批卡首屏完整（动作/站点/影响/一次批） | O1：敢批、懂影响 | `TaskStatusCard` 条件渲染顺序；`chijie-approval-card` | 真机/截图：未滚到底也能批；未批 0 提交 |
| 2 | **完成区强制「结果句 + 成果槽」**：无文件也要可观察结论；有 deliverable 时 `completion-deliverable` 必显可点/可复制 | M0-4、后续 R/T 故事 | `chijie-done-block` + completion-outcome | 无空完成；有成果必有入口 |
| 3 | **Activity live 一句对准用户动词**：优先 displaySummary；缺省时用「正在{人话动作} · host」；禁止 actionName 英文进 live | M0-1、O1 演示感 | `activity-stream` + `chijie-activity-live` | ui-acceptance：无 Planner/tool 名 |
| 4 | **失败/等待下一动作单主按钮**：每个 waitReason 只一个主 CTA + 停止仍在 controls；文案只走 taxonomy/hint | M0-5 | `chijie-next-step` + wait-affordance | 失败卡无 raw category 默认展示 |
| 5 | **页内条与侧栏状态同源文案**（侧栏侧：running 时 live 与 content 条语义一致；waiting_approval 默认侧栏持有批准、页内条隐藏或极淡） | M0-3 一致感 | content 条（005）+ `chijie-activity-live` | 停/完成/离 tab 后条消失；侧栏状态同步 |

**不做的 diff：** 新配色、新字体体系、聊天主面化、个性化 feed、第二套卡片组件名。

---

## Mapping quick ref

```text
Goal          → 上表 Feature 列
Flow          → §2 A/B/C
UI 节点       → TaskStatusCard 区块 + SidePanel shell
Atomic        → chijie-* + presentation/*
产品门        → product/017 G-M0/G-M3 + product/018 跑分
视觉/动效     → design/004
任务 UX 原则  → design/005
```

## Out of scope

- Options 页布局（见 003/004 options 段）
- 执行核算法、模型选型
- Claw 30 业务能力本身（抽表/日历等）— 只保证侧栏在故事跑分时 **看得见、可批、可停、可核对**
- 个性化与更深 Jarvis 叙事（018 门前禁止抢跑）

## Acceptance（本文）

| # | 检查 |
|---|------|
| D1 | 每个现有 Feature 有 Goal/Trigger/Success，无绿场功能 |
| D2 | 三条 Flow 均写失败态与禁止泄漏 |
| D3 | Atomic 表 class 均能在 `chijie-components.css` 找到 |
| D4 | Gap 表锚定 M0 + O1/018，不写个性化 |
| D5 | UI diff ≤ 5，且可映射到现有组件文件 |

---

## Implementation map（改 UI 时打开）

| File | 用它做什么 |
|------|------------|
| `pages/side-panel/src/SidePanel.tsx` | shell、workspace、composer、bind chip |
| `pages/side-panel/src/components/TaskStatusCard.tsx` | 三态节点顺序与操作 |
| `pages/side-panel/src/design/chijie-components.css` | 原子样式，不新造前缀 |
| `pages/side-panel/src/design/contracts.ts` | 按钮/卡 class 常量 |
| `pages/side-panel/src/presentation/*` | 全部用户可见映射 |
| `pages/side-panel/src/design/ui-acceptance.feature.md` | UI 行为验收 |
