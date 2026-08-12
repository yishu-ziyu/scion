# 008 侧栏进度控制台 · 差距审计

日期：2026-08-12
范围：Chrome side-panel vs `docs/design/008-long-horizon-task-progress-console.md`
权威：`docs/product/021` · `docs/design/008` · `docs/decisions/004`
代码根：`projects/chijie-browser/pages/side-panel/src/`

## 结论（一句）

Living Reader 的稳定目标、五阶段 Gate、方向调整与中断恢复壳已落地；008 要求的 **Health / Now / 首屏互斥 / 聊天折叠 / 通用任务里程碑** 仍缺，且部分测试**主动禁止** Health 与 currentActivity，与 008 合同冲突。

```text
008 首屏（应有）              现状（可观察）
─────────────────            ─────────────────────────────
1 Mission 稳定目标           ✅ TaskProgressOverview 任务目标
2 Progress 里程碑+Gate       ✅ LR 五阶段；generic 仍跟 plan.phases
3 Now 动作+目的+页面         ❌ 无 currentActivity；仅 ThinkingReasoning 流水
4 Health 健康/是否介入       ❌ 模型与 UI 均无 health；测试 assert 不存在
5 Findings 最新成果          ✅ research 最近 2 条证据
6 Outputs 产物               ✅ 飞书表/文档（LR）
7 Audit 折叠操作记录         ⚠️ 运行中默认展开「思考中…」+ 最近 3 步
composer 连续控制            ⚠️ 有暂停/调整；停放在卡片内，非固定旁侧
```

---

## 已落地（与 008 一致的部分）

| 008 条款 | 证据（路径 / 可观察行为） |
|---|---|
| 稳定 Mission，follow-up 不覆盖目标 | `TaskStatusCard` 用 `missionInstruction` + `deriveTaskProgressView`；LR 固定标题「Living Reader 下一阶段能力决策」。`displayGoalText` 不再单独当进度标题。 |
| 方向调整独立事件 | `SidePanel.tsx` `changeType: 'direction_change'`；`TaskProgressOverview` `data-testid="task-direction-change"`。 |
| LR 五结果里程碑 + durable Gate | `presentation/task-progress-view.ts` `researchProgressView`：理解项目 / 用户研究 / 产品研究 / 交叉验证与决策 / 飞书交付与回读；计数来自 `evidenceSpaceProgress`。 |
| 合格数 + 原始数 + 未计入原因 | Gate `detail`：`qualificationDetail(...)`；单测 `task-progress-view.test.ts`。 |
| 禁止动作数驱动 LR 进度 | research 路径不用 attempt 数推进 phase；单测「projects durable research counts instead of heuristic action progress」。 |
| Gate 视觉封顶（不显示 >100% 条） | `MissionPlanList` `scaleX(min(1, current/target))`。 |
| 运行 / 暂停 / 等待 在 plan 项上投影 | `missionPlanItemStatus`：active+paused→paused，不保留 active 动效。 |
| 中断紧凑恢复面 | `task-interrupted-status` + 继续 / 调整方向；停止进 more 菜单。 |
| composer「当前页面」绑定 | `SidePanel.tsx` `chijie-bind-chip` + `chat_task_bind_kicker` =「当前页面」。 |
| 连续控制入口存在 | 暂停 / 继续 / 调整方向 / 停止；无「批准一次」文案（`ui-acceptance.test.ts`）。 |
| 验证完成回执 | `shouldShowVerifiedDone` + `completion-receipt`；模型 done 不单独过门。 |
| Findings / Outputs（LR） | `task-progress-findings` / `task-progress-artifacts`。 |
| 无逐步审批 UX | side-panel 无 approval 主路径（decision 004）。 |

---

## Top gaps（10）

### G1 · Health 整层缺失（三秒标准 #4 · G21-V5）

- **008**：`TaskProgressView.health`：`advancing | recovering | slow | needs_user | paused | failed | complete` + `summary` + `lastMeaningfulProgressAt`；用户文案「正常推进 / 正在换路 / 进展放缓 / 需要你 / 已暂停」。
- **现状**：`TaskProgressView` 无 `health` 字段。`TaskProgressOverview` 不渲染 health。单测**硬断言** `expect(view).not.toHaveProperty('health')`（`presentation/__tests__/task-progress-view.test.ts`）；`ui-acceptance` 要求不存在 `task-progress-health` / `.chijie-progress-health`。
- **可观察失败**：用户无法在首屏判断要不要介入；只能猜聊天流或动作列表。
- **严重度**：P0
- **修复层**：runtime-data（投影 health 规则）+ presentation（一行文案）+ component（Overview 区块）。勿恢复逐步审批。

### G2 · Now / currentActivity 缺失（三秒标准 #3 · G21-V4）

- **008**：`currentActivity: { summary, purpose, site?, startedAt }`；「动作 + 对象 + 目的」，非 CoT；与 composer 页面上下文分离。
- **现状**：读模型无 `currentActivity`；同文件测试 `not.toHaveProperty('currentActivity')`。运行态用 `ThinkingReasoning` 显示「思考中…」+ 最近 attempt 摘要列表，**无 purpose、无服务阶段**。
- **可观察失败**：用户只看到「打开某站」流水，看不到「这是在完成用户研究门」。
- **严重度**：P0
- **修复层**：runtime-data（从最新 attempt + active milestone 投影）+ component（首屏 Now 一行，非无限流）。

### G3 · 运行态「思考中」循环动效 + 审计默认展开（G21-V4 / 展开层级 / 视觉）

- **008**：首层只显示当前语义动作；完整操作记录折叠到审计；禁止循环呼吸动画；`prefers-reduced-motion` 只留文字颜色。
- **现状**：`ThinkingReasoning.tsx` 运行中 `open` 强制 true、`disabled` 不可收起、文案「思考中…」；`chijie-components.css` `.chijie-thinking-label.is-shimmer` 无限 `animation`。`visibleAttemptWindow` 运行中仍 slice 最近 3 条并默认展开。
- **可观察失败**：侧栏像调试控制台；中断/暂停后若仍有 steps，面板以 secondary 再露一遍。
- **严重度**：P0（假运行感 / 噪音）
- **修复层**：component + tokens（审计默认折叠；去掉无限 shimmer；Now 一行优先）。

### G4 · 卡片头 `task-site` 与 Agent 活动混读（G21-V4）

- **008**：runtime activity 与 composer page context 分离；「当前页面」不得冒充 Agent 正在读。
- **现状**：composer 已标「当前页面」（正确）。同时 `TaskStatusCard` header 始终渲染 `data-testid="task-site"`（`siteHostLabel(snapshot)`），与状态 pill 同排。暂停/中断时仍显示站点 chip，易读成「正在该站工作」。
- **可观察失败**：中断任务仍像钉在某站点的 live 会话。
- **严重度**：P0
- **修复层**：presentation / component（site 只进 Now 或只留 composer；中断/暂停卡片头只留互斥状态）。

### G5 · 通用任务里程碑仍是指令切片（G21-V3 · 008 禁止启发式 phase）

- **008**：里程碑由 Gate/产物推进；禁止「每个 observed action 完成一个 phase」；禁止碎片阶段如「你现在接」。
- **现状**：非 LR 走 `genericProgressView`，直接 map `snapshot.plan.phases`。后台 `refineMissionPlanFromInstruction` 按分号/句段切 phase 标题（`mission-plan.ts`）。无 durable criteria 时 gates 为空，`MissionPlanList` 仍显示 `done/N 阶段` 与 pie 百分比（阶段数比例，非目标进度）。
- **可观察失败**：通用任务仍可能出现 0/12 式碎片计划；与 008 Before 表同一病。
- **严重度**：P0（通用路径）
- **修复层**：runtime-data（结构化里程碑或至少隐藏无 Gate 的假进度 pie）；side-panel 可先：**无 gate 时不显示 x/y 百分比 pie**。

### G6 · 聊天日志默认占满 flex 阅读区（信息架构 · G21 首屏）

- **008**：任务状态属控制台；聊天只承载委托/追问/方向修正；默认折叠旧对话。
- **现状**：`SidePanel.tsx` `chijie-chat-log` 为 `flex-1 overflow-y-scroll`；任务进行中 `MessageList` 全量消息默认展开。进度卡 `max-height: min(58vh, 560px)` 后聊天抢首屏。
- **可观察失败**：用户要滚过对话才能盯住 Gate；状态与消息竞争。
- **严重度**：P1
- **修复层**：component / layout（任务 active 时聊天默认折叠为「对话 N 条」）。

### G7 · 暂停态首屏未达到 008 示例密度（G21-V1/V2 可读性）

- **008 暂停示例**：已中断标题、当前里程碑、Gate 76/80、原始 91、最后进展相对时间、继续后 nextStep、[继续][调整方向]。
- **现状**：`interrupted` 面只有「任务已中断，进度已经保存」+「可以从「{milestone}」继续」。`view.nextStep` 在有 active milestone 时**被盖掉**（只显示阶段名）。paused（非 interrupted）只有按钮，无「最后进展 / 继续后」。
- **可观察失败**：暂停后看不到距离验收还差什么、下一步是什么。
- **严重度**：P1
- **修复层**：component（Interrupted/Paused 首屏复用 Gate + nextStep + last progress）。

### G8 · 连续控制未固定在 composer 旁侧（G21-V7 交互布局）

- **008**：固定 Continuous-control composer；旁侧暂停/继续；停止进次级/危险区。
- **现状**：暂停/继续/停止在 `TaskStatusCard` 内 `task-continuous-controls`；composer 的 `showStopButton={false}`。运行中 Stop 与 Pause 同级 danger/secondary 并排，未降级到次级菜单（interrupted 才 demote stop）。
- **可观察失败**：控制入口随卡片滚动；与 008 固定控制条不一致。
- **严重度**：P1
- **修复层**：component（composer 旁侧 pause/resume；stop 进 more）。

### G9 · LR 飞书交付 Gate 粒度不足（Living Reader 映射 · G21-V2）

- **008**：飞书交付与回读应 4 门：研究表创建、研究表回读、决策文档创建、决策文档回读。
- **现状**：单一 Gate「已验证交付物」`current/target = 2`，仅统计 `research_table` + `decision_document` 是否存在；不区分创建 vs 回读。
- **可观察失败**：用户看不到「建了但未回读」的半完成态。
- **严重度**：P1
- **修复层**：runtime-data（`researchDelivery` 投影 4 gate；需 storage 字段是否已分创建/回读——若无则只标 partial，不伪造）。

### G10 · 健康规则数据未消费（slow / recovering）

- **008**：`meaningful progress` = Gate/证据/里程碑/产物；多周期无进展 → slow；策略切换 → recovering。
- **现状**：`EvidenceSpace.workCycles` 在 background 有更新，side-panel 读模型不用于 health。无 recovering/slow 判定。
- **可观察失败**：卡住时仍可能只显示「执行中」或空白，用户不知该不该介入。
- **严重度**：P1（依赖 G1）
- **修复层**：runtime-data（纯函数：status + workCycles + last evidence timestamp）。

### G11 · 动效与触控目标未完全对齐 008（G21-V8 视觉）

- **008**：状态变化 140–180ms；Gate 一次 short cross-fade；按钮 `scale(.97)`；首层目标 ≥40×40；320px/200% 无横滚。
- **现状**：`RollingCharacter` 380ms 翻滚；plan pie 用阶段完成比；thinking 无限 shimmer；部分按钮 `min-height: 32px`（interrupted）。`prefers-reduced-motion` 有全局压制，但 shimmer keyframes 仍在源码中。
- **可观察失败**：窄侧栏像炫技；触控目标偏小。
- **严重度**：P2
- **修复层**：tokens / CSS。

### G12 · 展开状态不跨重渲保持（交互）

- **008**：用户展开状态在同一 Task 内保持；阶段变化不得强制自动滚动。
- **现状**：`MissionPlanList` / `ThinkingReasoning` 本地 `useState`，无 taskId 记忆；Thinking 在 running 变化时 `setOpen(running)` 强制重开。
- **可观察失败**：用户收起计划后状态一变又被顶开（thinking 路径）。
- **严重度**：P2
- **修复层**：component。

---

## 按 008 验收门对照

| Gate | 判读 | 依据 |
|---|---|---|
| G21-V1 稳定目标 | **基本过（LR）** | mission 固定 + direction_change |
| G21-V2 真实进度 | **LR 过半；交付 4 门不足** | durable gates + detail；飞书 2/2 合并 |
| G21-V3 结果阶段 | **LR 过；generic 未过** | research 5 阶段；generic = plan.phases |
| G21-V4 状态一致 | **部分过** | plan 项互斥好；缺 Now、site 混读、思考中动效 |
| G21-V5 健康可懂 | **未过** | health 被删且测试锁定 |
| G21-V6 成果可见 | **LR 过半** | findings/artifacts 有；非 LR findings 空 |
| G21-V7 连续控制 | **功能有、布局未过** | 无逐步审批；控制不在 composer 旁 |
| G21-V8 真实侧栏 | **未在本审计跑真机** | 代码层有 reduced-motion；需 430/320/200% Chrome 验收 |

---

## 推荐 S1（唯一用户可见切口）

**恢复一条互斥 Health 行，并在非 `running` 时去掉运行态「思考中…」/ shimmer。**

不做：后台 executor 大改、逐步审批、完整七层 IA 重排、通用 planner 重构。

### S1 one-liner

侧栏任务卡在 Mission/计划下方固定显示一行 Health；暂停/等待/失败/完成与「思考中」运行动画严格互斥。

### Done（可证伪）

**When I** 在运行中的任务点「暂停」（或任务变为 `interrupted` / `waiting_user`），
**I see** Health 文案分别为「已暂停」/「已暂停」（中断）/「需要你…」，且 `task-thinking-reasoning` **不**出现「思考中…」与 shimmer；
**When I** 再点「继续」回到 `running`，
**I see** Health 为「正常推进」（或暂时等价「执行中」）且可与计划并存。

### 精确改动路径

| 路径 | 改动 |
|---|---|
| `pages/side-panel/src/presentation/task-progress-view.ts` | 增加 `health: { state, summary, lastMeaningfulProgressAt? }`；由 `snapshot.status` + `evidenceSpace.updatedAt` / 最近 finding 时间投影；**不**用动作数。 |
| `pages/side-panel/src/components/TaskProgressOverview.tsx` | 渲染 `data-testid="task-progress-health"` 一行。 |
| `pages/side-panel/src/components/TaskStatusCard.tsx` | 非 running：`ThinkingReasoning` 的 `running={false}` 且勿主推运行 chrome；可选隐藏卡片头 site 当 paused/interrupted。 |
| `pages/side-panel/src/components/ThinkingReasoning.tsx` | 去掉强制 running 不可折叠 + 无限 shimmer（或 CSS 禁用循环）。 |
| `pages/side-panel/src/design/chijie-components.css` | `.chijie-progress-health`；去掉/门控 infinite shine。 |
| `pages/side-panel/src/presentation/__tests__/task-progress-view.test.ts` | **反转** `not.toHaveProperty('health')` → 断言状态映射。 |
| `pages/side-panel/src/design/__tests__/ui-acceptance.test.ts` | 删除「完全移除 health」断言；改为存在 health testid。 |
| `pages/side-panel/src/components/__tests__/mission-plan-list.test.ts` | Overview 中断面可与 health 并存（文案不重复即可）。 |

不需要改 background agent 核心即可完成 S1；若 `lastMeaningfulProgressAt` 要从 evidence 取，只读已有 `EvidenceSpace`。

---

## Out of scope（本切片与后续 brief 提醒）

- **禁止**恢复逐步审批 / `waiting_approval` / 「批准一次」主路径（decision 004）。
- **不要**为了 Health 去改 executor 策略或重新引入外部提交阻塞。
- **不要**把 S1 扩成完整七层 IA + 通用 planner + 飞书 4 门 + composer 旁侧控制（那是 P1/P2）。
- **不要**为 Living Reader 写死不可复用仪表盘；health 规则应对所有 `TaskSnapshot` 通用，LR 只是验收样本。
- Historical 文档 003/011/018 不得重新定义侧栏目标。

---

## S1 收口句

**S1：** 互斥 Health 行 + 非 running 禁止「思考中」假运行。
**Done：** when I pause a task I see Health「已暂停」and no shimmer「思考中…」.
**Touch：** `task-progress-view.ts` · `TaskProgressOverview.tsx` · `TaskStatusCard.tsx` · `ThinkingReasoning.tsx` · `chijie-components.css` · 上述 3 个测试文件。
