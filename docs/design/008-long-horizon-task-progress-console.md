---
title: "持节长程任务进度控制台"
description: "定义 Chrome 侧栏如何让用户持续看懂长程任务的目标、阶段、真实进度、运行健康度、证据、产物与干预入口。"
category: "design"
number: "008"
status: current
services: ["projects/chijie-browser/pages/side-panel", "projects/chijie-browser/chrome-extension/src/background/task", "projects/chijie-browser/packages/storage"]
related:
  - "product/021"
  - "product/023"
  - "decisions/004"
last_modified: "2026-08-11"
---

# 008 — 持节长程任务进度控制台

## 状态

**current，Owner 已确认产品目标。**

持节不只要“做得成”和“证明做成”，还必须让用户在执行期间持续看懂并随时纠正。Chrome 侧栏因此不是聊天框或调试日志，而是长程任务的实时控制台。

完整产品定义：

> **持节是一个可自主执行、可随时看懂、可及时干预、可验证交付的 Chrome 长程任务 Agent。**

本设计直接落实 `product/021` 的“执行过程中展示当前阶段、关键结果、下一步”和“用户随时修正”要求。Living Reader `023-LR-01` 是首个真实验收任务，不是专用界面。

## 真实界面审计（2026-08-11）

证据：中断中的 `023-LR-01` 真实侧栏。证据空间包含 `91` 条原始用户记录，但按正式来源过滤与去重口径只有 `76/80` 条合格用户讨论；产品为 `26/30`。旧界面主要显示修正指令、`0/12` 启发式计划与 `546` 条操作记录。

| Before | After | Why |
|---|---|---|
| “当前目标”展示一整段最新 follow-up | 展示稳定 Mission 标题；修正内容进入“方向调整”事件 | 目标不能随每次纠正漂移，否则用户无法建立稳定心智模型 |
| 启发式切出 12 个碎片阶段，如“你现在接”“用户放弃”“PDF” | 4–7 个有结果语义的里程碑，如“理解项目”“用户研究”“产品研究”“交叉验证”“交付验证” | 阶段必须代表可验收结果，不是原始指令切片 |
| 计划显示 `0/12`，与已完成的大量研究冲突 | 里程碑状态由持久证据和验收门驱动；显示合格用户讨论 `76/80`、原始记录 `91` 与未计入原因、合格产品 `26/30` | 进度必须来自 durable state，并解释计数口径；不能从动作次数或模型文案推断 |
| “操作记录 546”是最显眼的数量 | 首层只显示当前语义动作、最近一次有效进展和健康度；完整操作记录折叠到审计详情 | 动作数量不等于目标进度，且会把噪音误当成工作量 |
| 中断时仍显示“正在读 aicss.dev”和运行计时器 | 运行、暂停、中断、等待用户和失败严格互斥；中断时显示最后检查点和继续后的下一步；composer 绑定区只标“当前页面” | runtime activity 与下一条指令的页面上下文是两类状态，不能混为一谈 |
| 真实计数只埋在目标长文本里 | 已知总量使用独立 Gate 卡；未知总量使用阶段检查点，不伪造百分比 | 用户应一眼看到距离验收还有什么 |
| 聊天消息重复承载任务状态变化 | 任务状态属于控制台；聊天只承载委托、追问和方向修正 | 避免状态、计划、消息互相竞争 |
| 没有运行健康解释 | 显示“正常推进 / 进展放缓 / 正在换路 / 需要你 / 已暂停”，并说明依据 | 用户需要判断是否应介入，而不是盯着动作流猜测 |

## 三秒理解标准

侧栏首屏必须让用户在三秒内回答：

1. **目标是什么？** 最终要交付什么。
2. **进行到哪里？** 当前里程碑、已通过门、未通过门。
3. **现在做什么？** 当前动作及其服务的阶段，不展示内部思维过程。
4. **运行是否健康？** 正常推进、正在恢复、进展放缓、需要用户、暂停或失败。
5. **已经得到什么？** 证据、阶段结论、文件、页面或最终回执。
6. **我能做什么？** 暂停、继续、纠正方向、追问或停止。

如果用户必须展开 500 条日志、阅读聊天历史或自己比较前后页面才能回答，设计失败。

## 信息架构

约 430 CSS px 的真实 Chrome 侧栏按以下顺序组织：

```text
固定 Header
  品牌 · 唯一任务状态 · 新任务 / 历史 / 设置

可滚动 Task workspace
  1. Mission：稳定目标 + 最终交付
  2. Progress：里程碑 + 已知验收门
  3. Now：当前动作 + 目的 + 当前页面
  4. Health：最近有效进展 + 重试/换路/等待说明
  5. Findings：最新关键结果与累计证据
  6. Outputs：阶段产物与最终交付物
  7. Audit：折叠的完整操作记录和技术回执

固定 Continuous-control composer
  补充、纠正、追问；旁侧为暂停/继续，停止进入次级菜单或危险区
```

### 首屏优先级

1. 当前状态与需要用户处理的事情。
2. 当前里程碑和真实 Gate。
3. 当前动作及其目的。
4. 最新有效成果。
5. 控制入口。

Logo、原始对话、动作总数和技术回执不得挤占以上内容。

## 用户可见任务读模型

现有 `TaskSession + MissionPlan + EvidenceSpace` 是运行时事实源，但不应直接按存储结构渲染。侧栏消费一个稳定的 presentation read model：

```ts
interface TaskProgressView {
  mission: {
    title: string;
    deliverable: string;
  };
  status: 'planning' | 'working' | 'verifying' | 'delivering'
    | 'paused' | 'needs_user' | 'completed' | 'failed';
  milestones: Array<{
    id: string;
    title: string;
    status: 'planned' | 'active' | 'done' | 'blocked';
    summary?: string;
    gates: ProgressGate[];
  }>;
  currentActivity?: {
    summary: string;
    purpose: string;
    site?: string;
    startedAt: number;
  };
  health: {
    state: 'advancing' | 'recovering' | 'slow' | 'needs_user'
      | 'paused' | 'failed' | 'complete';
    summary: string;
    lastMeaningfulProgressAt?: number;
  };
  findings: Array<{ id: string; title: string; detail?: string; observedAt: number }>;
  artifacts: Array<{
    id: string;
    title: string;
    kind: 'table' | 'document' | 'file' | 'page' | 'receipt';
    status: 'draft' | 'created' | 'verified';
    url?: string;
  }>;
  nextStep: string;
  updatedAt: number;
}

interface ProgressGate {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'passed' | 'blocked';
  current?: number;
  target?: number;
  unit?: string;
  detail?: string; // 计数口径、原始数量与未计入原因
}
```

原则：

- 运行时继续保存可恢复事实；`TaskProgressView` 只做稳定、脱敏、可解释的产品投影。
- Gate 的 `current/target` 必须来自持久证据、验收器或页面回读，不允许模型文案直接写数。
- Gate 经过过滤或去重时，必须同时显示合格数、原始记录数和未计入原因；用户不应猜测为什么数字减少。
- runtime activity 与 composer page context 分离：前者描述 Agent 正在做什么，后者只描述下一条指令将作用的当前页面。
- 每次有效 Gate、里程碑、健康或产物变化都要推进 `updatedAt` 并触发侧栏快照。
- currentActivity 是“动作 + 对象 + 目的”，不是 chain-of-thought。

## 进度语义

### 允许展示百分比或 `x/y`

仅当总量可信且语义稳定：

- 明确用户配额，如 `26/30 个产品`。
- 明确验收门，如 `2/4 条飞书交付回读门`。
- 文件批量处理，如 `18/42 个文件`。

合格数超过目标时显示 `91/80 已达标`，视觉上封顶，不显示 114% 的进度条。若原始记录多于合格数，则显示例如 `合格 76/80；原始 91，15 条因来源过滤或去重未计入`。

### 禁止展示统一百分比

- 开放式调研“完成 63%”。
- 用浏览页面数、工具调用数或 token 数估计目标完成度。
- 将不同单位的 Gate 相加成一个看似精确的总进度。

无可信总量时展示“里程碑 + 通过门 + 下一步”。

### 里程碑推进

里程碑由结果推进，不由动作数量推进：

- `done`：对应 Gate 全部通过或产物已验证。
- `active`：当前动作明确服务于该里程碑。
- `blocked`：存在可说明的阻塞；必须同时给出换路或用户动作。
- `planned`：尚未开始。

禁止继续使用“每个 observed action 完成一个 phase”的启发式作为用户可见进度。

## 运行健康度

健康度回答“需不需要我介入”，不是后台监控面板。

| 状态 | 用户文案 | 判定依据 |
|---|---|---|
| `advancing` | 正常推进 | 最近窗口内 Gate、证据、里程碑或产物有有效增长 |
| `recovering` | 这条路未成功，正在换一种方式 | 单页失败、页面变化或一次策略切换，仍在自主边界内 |
| `slow` | 一段时间没有新进展，正在重新规划 | 多个工作周期没有 meaningful progress；不得假装正常 |
| `needs_user` | 需要你完成登录 / 验证码 / 授权 | 仅 `product/023` 定义的用户边界或明确不可逆风险 |
| `paused` | 已暂停 | 不得同时显示实时运行点、计时器或“正在读取” |
| `failed` | 未完成，并说明缺失门 | 已耗尽恢复路径或验收门无法通过 |
| `complete` | 已验证完成 | receipt 与全部 required Gates 一致 |

`meaningful progress` 只包括：Gate 数值增长、有效证据增加、里程碑通过、产物创建/回读、阻塞解除。鼠标点击和页面滚动不算。

## Living Reader 首个映射

`023-LR-01` 应显示五个里程碑：

1. **理解项目**：仓库 HEAD、能力地图、浏览器上下文。
2. **用户研究**：`合格用户讨论 76/80，还差 4`；同时显示原始 `91` 条及 `15` 条未计入原因。
3. **产品研究**：`产品 26/30，还差 4`。
4. **交叉验证与决策**：三个能力逐项满足 `2 用户 + 1 产品 + 1 代码`，最终数量必须为 3。
5. **飞书交付与回读**：研究表创建、研究表回读、决策文档创建、决策文档回读。

暂停时的首屏示例：

```text
已中断
Living Reader 下一阶段能力决策

当前：用户研究
合格用户讨论  76/80  还差 4
原始记录      91     15 条未计入
合格产品      26/30  计划中

最后进展：记录 Zotero 产品证据 · 2 分钟前
继续后：补足 4 条合格用户讨论证据，再进入产品研究

[继续]  [调整方向]
```

完整 `546` 条动作仍保留在“审计记录”，但不参与进度，也不默认展开。

## 交互

### 连续控制

- `暂停`：立即停止新动作，保留检查点；按钮原位切换为 `继续`。
- `调整方向`：聚焦 composer，并预置“我想调整……”提示；提交后形成有时间的 direction-change 事件，但不改写原 Mission。
- `追问`：允许询问“为什么在看这个”“目前发现了什么”，回答不应强制打断任务。
- `停止`：危险次级操作，说明会结束任务但保留已有证据和产物。

### 展开层级

- 默认展开：当前里程碑、当前活动、健康、最新成果。
- 默认折叠：已完成里程碑细节、旧对话、完整操作记录、技术回执。
- 用户展开状态在同一 Task 内保持；阶段变化不得强制自动滚动。

## 视觉与动效

- 延续浅色、安静、任务优先方向；系统字体优先，持节绿色仅用于运行与通过。
- 运行状态变化使用 140–180ms opacity/color transition；不做循环呼吸和整卡闪动。
- Gate 数值增长只做一次短 cross-fade；不要用弹跳、confetti 或无限进度动画。
- 按钮按下提供即时 `scale(.97)` 反馈；暂停/继续从当前视觉状态中断并反转。
- `prefers-reduced-motion` 下只保留文字和颜色变化。
- 320px 宽、200% zoom、中文长文案下无横向滚动；首层交互目标至少 40×40px。

## 验收门

| Gate | 通过条件 |
|---|---|
| G21-V1 稳定目标 | follow-up 不再替换 Mission；方向调整有独立可见事件 |
| G21-V2 真实进度 | 已知计数来自 durable evidence / verifier；合格数、原始数和过滤/去重口径可解释；无可信总量时不显示百分比 |
| G21-V3 结果阶段 | 用户可见里程碑由 Gate/产物推进，不由动作数推进 |
| G21-V4 状态一致 | 运行、暂停、中断、等待、失败、完成视觉互斥；无陈旧活动或计时器；“当前页面”不冒充 Agent 活动 |
| G21-V5 健康可懂 | 三秒内能判断正常、换路、放缓、需要用户或失败，并看到原因 |
| G21-V6 成果可见 | 阶段成果、证据计数、产物与验证状态可打开或展开检查 |
| G21-V7 连续控制 | 暂停、继续、调整、追问、停止可用；无逐动作审批回归 |
| G21-V8 真实侧栏 | 430px、320px、200% zoom 与中英文主路径通过真实 Chrome 验收 |

## 实施顺序

### Slice P0：事实正确

1. 增加 `TaskProgressView` 或等价稳定读模型。
2. 接入 durable evidence、required criteria、research decision 与 delivery readback。
3. 去掉动作数驱动的用户可见 phase 推进。
4. 修复暂停状态仍显示陈旧活动。
5. 为 `023-LR-01` 显示五阶段和真实 Gate。

### Slice P1：首屏重构

1. Mission、Progress、Now、Health、Findings、Outputs、Audit 分层。
2. 默认折叠聊天与完整动作记录。
3. 固定连续控制 composer，加入清晰的调整方向入口。

### Slice P2：精修与泛化

1. 通用任务的 planner 结构化里程碑输出。
2. 进展放缓与换路健康规则。
3. 真实 Chrome 430px / 320px / 200% zoom、reduced-motion 和中英文验收。

## 非目标

- 不展示 chain-of-thought、内部 Agent 角色、selector、digest 或 raw args。
- 不做任务管理后台、甘特图、无限层级项目管理器。
- 不用动画掩盖缺失的真实状态。
- 不为 Living Reader 写死一个不可复用的研究仪表盘；它只是第一个 adapter 与验收样本。
