---
title: "持节安静任务控制台（侧栏三态视觉与动效）"
description: "把侧栏统一为任务优先的浅色控制台，细化运行中、等待批准、已验证三态及其数据契约、动效和验收。"
category: "design"
number: "004"
status: current
services: ["projects/chijie-browser/pages/side-panel", "projects/chijie-browser/chrome-extension/src/background/task", "projects/chijie-browser/packages/storage"]
related: ["product/003", "product/008", "design/001", "design/003"]
last_modified: "2026-07-15"
---

# 004 — 持节安静任务控制台

## Status

**current（视觉方向、字体与任务优先结构已确认；侧栏三态和关键交互已实现并通过自动化与真实浏览器验收）。**

- 已确认：浅色、安静的任务控制台。
- 已确认：保留 `Space Grotesk + Noto Sans SC`。
- 已确认：持节绿色作为品牌与运行/验证语义色。
- 已确认：任务优先；聊天退居补充意图与连续控制。
- 已确认：运行中、等待批准、已验证三态并行细化，再统一实现。
- 本文是 [003-chijie-ui-interaction.md](003-chijie-ui-interaction.md) 的视觉与状态细化；003 继续保留信息架构和原始交互图。

## Why

当前产品契约已经具备 Task、Round、审批、页面证据和完成回执，但实现视觉与交互层级发生漂移：

- 003 的源图是浅色 macOS/Safari 旁栏方向；改造前 tokens 是黑底、暖纸和红色主色。
- 页头和任务卡重复显示总状态。
- 当前 `attempts` 同时充当进度分子和分母，等待审批时还人为增加一步；未提交也可能显示满格 `1/1`。
- 审批摘要可能直接显示英文 `Perform the requested external action`，无法回答动作、对象和影响。
- 完成态重复显示状态、100% 进度和回执，但页面证据只有泛化文案。
- 评分和保存 Skill 被提升为多个全宽主按钮，稀释任务结果。
- 卡片、聊天和 composer 同权竞争，长任务把连续控制入口挤出首屏。

真实证据：

- `../../.ship/tasks/tabbit-class-product/qa/screenshots/sidepanel-clean.png`
- `../../.ship/tasks/tabbit-class-product/qa/screenshots/form-waiting-approval.png`
- `../../.ship/tasks/tabbit-class-product/qa/screenshots/youtube-final-sidepanel.png`
- `../../.ship/tasks/tabbit-class-product/qa/browser-report.md`

## Product contract that must not move

1. 用户委托的是浏览器任务，不是与侧栏聊天机器人闲聊。
2. 真实网页必须发生可观察变化。
3. 对外提交只批准一次，目标变化后旧批准失效。
4. 模型说 `done` 不算完成；只有页面证据生成匹配当前 Round 的 receipt 才算。
5. follow-up 创建同一 Task 的新 Round，不改写旧 Round 和旧 receipt。
6. UI 不显示 Planner、Navigator、`step_failed`、raw args、digest 或表单值。

## Shared shell

约 430 CSS px 宽度下：

```text
固定 Header
  品牌 · 唯一总状态 · 新任务 / 历史 / 设置

可滚动 Task workspace
  目标与站点
  当前状态专用区
  最近步骤 / 折叠历史
  当前状态允许的操作
  折叠的对话记录

固定 Continuous-control composer
  补充、暂停、调整或继续下一轮
```

规则：

- Header 高 56–64px，只在这里显示任务总状态。
- composer 固定在底部；任务区独立滚动。
- 当前 Task 是唯一展开主面；旧 Round 以后续摘要存在。
- 运行态最多直接展示最近三步，更早步骤折叠。
- 页面中只保留一个“停止任务”。
- 320px 宽和 200% zoom 下单列重排，不横向滚动。

## Visual system

### Color

| Token | Value | Use |
|---|---:|---|
| canvas | `#F5F7F5` | 侧栏背景 |
| surface | `#FFFFFF` | 卡片、输入 |
| surface-subtle | `#F2F5F1` | 次级状态区 |
| ink | `#16231F` | 主文字 |
| ink-soft | `#52615C` | 正文辅助文字 |
| ink-metadata | `#6B7772` | 小号时间与元数据；不得更浅 |
| border | `#DBE1DC` | 分隔线、卡片边框 |
| brand-green | `#176C52` | 运行、主操作、已验证 |
| brand-green-hover | `#125842` | hover/pressed |
| brand-green-soft | `#E6F2ED` | 运行/验证浅背景 |
| approval-amber | `#93641A` | 等待批准、结果不确定 |
| approval-amber-soft | `#FFF6E5` | 审批浅背景 |
| danger-red | `#B63F38` | 明确失败、结束任务 |
| danger-red-soft | `#FBECEA` | 失败浅背景 |

红色不得表达运行、批准或完成；琥珀不得表达普通进度。

### Type

- 正文：`Space Grotesk`, `Noto Sans SC`, system-ui。
- 时间、短 ID：`Space Mono` 或 `font-variant-numeric: tabular-nums`。
- 不在核心任务文案使用手写字体、全大写 mono 标签或过度字距。
- 目标：16/24px、600，最多三行后提供展开。
- 状态与按钮：12–14px、500/600。
- 元数据：至少 11px，并满足 4.5:1 对比度。

### Shape

- 卡片圆角 12–14px，1px 边框；不使用撕纸造型。
- 工作区左右 12px；卡片内 16px；区块间 12px。
- 不以阴影制造主层级；主要依赖留白、边框和状态色。
- 交互目标至少 40×40px；关键 CTA 高度至少 44px。

## Motion system

动效只解释状态变化，不承担唯一语义。

| Mechanism | Duration | Easing | Use |
|---|---:|---|---|
| 文案替换 | 140–180ms | `cubic-bezier(.2,.8,.2,1)` | phase/状态文案 |
| 新步骤进入 | 180ms | 同上 | opacity + 6px translate |
| 卡片重排 | 180–220ms | 同上 | 运行→审批→完成密度变化 |
| 完成入场 | 160ms | `cubic-bezier(.2,.75,.25,1)` | receipt event 后一次 |
| 控件颜色 | 120–160ms | ease-out | hover/selected/focus |
| 活动指示 | 900ms linear | linear | 仅当前 executing 行 |

禁止：confetti、循环成功脉冲、整卡呼吸、闪烁、震动、自动滚动。

`prefers-reduced-motion: reduce`：关闭 transform、rotation、pulse、height 和 smooth-scroll；保留文字、静态图标、颜色和 live-region。

## State A — Running

### User question

运行卡只回答：正在做什么、刚完成什么、在哪个页面、我现在能做什么。

### Hierarchy

1. Header：绿色状态点 + `运行中`。
2. 目标与 hostname；任务卡不再重复总状态。
3. 唯一实时状态行。
4. 最近三步；更早步骤折叠。
5. `暂停` 与三级 `停止任务`。
6. 折叠对话记录。
7. 固定 composer：`补充或调整当前任务…`。

运行中 composer 必须可输入 follow-up；当前背景层已经支持 `follow_up`，UI 不得把它锁死。

### Phase copy

| Phase / fallback | Main copy |
|---|---|
| no attempts | `正在准备任务` |
| observing | `正在读取当前页面` |
| planning | `正在决定下一步` |
| latest proposed | `准备{humanActionLabel}` |
| latest executing | `正在{humanActionLabel}` |
| latest observed + running | `已确认这一步，正在检查下一步` |
| verifying | `正在核对任务结果` |
| blocked + running | `这一步未生效，正在调整` |
| target changed | `页面已变化，正在重新确认操作` |

只有 `observed` 计为完成；`approved` 是“已批准，待执行”。

没有可信 `knownTotalSteps` 时，不显示百分比、进度条或 `x/x`。

### Presentation leakage（硬禁止）

**定义：** 内部执行状态、核名、协议字段未经映射进入用户主 UI。

主任务卡 / 步骤列表 / 完成区 **不得** 出现：`Planner`、`Navigator`、`step_failed`、`observe_failed`、`json_parse_failed`、`no_progress`、`ExecutorDriver`、`pageRevision`、后端名 `nano`/`control`、原始 `failureCategory` 字符串。

所有用户可见文案经 `presentation/*` + i18n；失败用产品码映射（见 `failure-taxonomy.ts`）。  
完整公理：`docs/product/014-executable-framework-axioms.md` Part C。  
工程与评测通道可以保留内部码；默认任务路径不能。

任务发出后的 **页内操作条 / 人话步骤 / 成果链接 / 停止与连续控制** 见 **[005-chijie-task-ux-from-claw.md](005-chijie-task-ux-from-claw.md)**（对标 Sider Claw，不抄工具 log）。

### Edges

- 暂停提交后立即禁用按钮；收到 paused snapshot 后显示最近已确认动作。
- 同一 phase 超过 8 秒可显示 `仍在工作 · Ns`；没有 heartbeat 时不得宣称健康。
- `blocked + running` 用琥珀恢复态；只有 Task `failed` 才使用红色。
- `commit_outcome_uncertain` 明确“可能已经提交，不会自动重试”。
- `interrupted`：继续前先重新观察页面。

## State B — Waiting for approval

### User question

审批卡必须回答：将做什么、对哪里做、影响是什么、批准后如何判断成功。

### Hierarchy

1. 状态：琥珀圆点 + `等待批准`；右侧 hostname。
2. 目标，最多三行。
3. 审批卡，必须在执行详情之前。
4. `N 步已完成 · 查看详情`；无假进度。
5. 卡外三级 `结束任务`。
6. 固定 composer，拒绝后用于继续修改。

### Copy contract

- 辅助句：`我已暂停，尚未向 {host} 提交。`
- 卡标题：`提交前确认`
- 主句：`将向 {host} 提交当前表单`
- 操作：`点击「提交」`
- 影响：`向该站点发送当前页已填写的内容`
- 完成后：`检查页面是否出现成功结果`
- 安全说明：`只批准这一次。页面或按钮发生变化时，本次批准会自动失效。`
- 主按钮：`批准并提交一次`
- 次按钮：`不批准，返回修改`

删除、购买、发送等 CTA 必须由结构化 `actionKind` 生成，不能把模型自由文本直接当按钮或正文。

### Lifecycle

```text
pending
  → approval command pending（按钮立即 disabled）
  → approved / revalidating target
  → consumed / executing
  → observed / verifying evidence
  → completed with receipt
```

目标变化：

```text
approved → invalidated → waiting_user / approval_target_changed
```

此路径必须保持零提交；旧批准不能自动复用。

结果不确定：

- `可能已经提交。为避免重复，我不会自动重试。`
- 不提供普通“重试提交”。
- 需要显式解决：已提交 / 未提交 / 仍不确定。

### Privacy

持久化只允许：action kind、origin、field count、digest、时间、reason code。

严禁持久化：

- input/textarea 值、密码、token、凭证；
- DOM 正文、截图、raw args、模型自由文本摘要；
- 未遮罩的邮箱、手机号、地址等预览值。

页面标题、按钮可见名、经过遮罩的影响清单只可作为临时 UI preview，不进入 Task durable storage。

## State C — Verified completion

### User question

完成态必须回答：完成了什么、页面证据是什么、回执在哪里、接下来能做什么。

### Hierarchy

1. 绿色图标 + `已验证完成`；右侧 hostname。
2. `本轮结论`：保守、证据约束的结果，不把原目标直接改写成完成时态。
3. 最多三条页面证据。
4. 默认折叠的 `查看完成回执`。
5. 紧凑评分：`符合预期 / 部分符合 / 不符合`。
6. 轻描边或文字按钮：`保存为 Skill`。
7. 固定 composer：`继续这个任务的下一步…`。

完成态不显示 `1/1` 进度条。

### Evidence display

| Criterion | Safe copy |
|---|---|
| URL | `已进入 {sanitized origin + pathname}` |
| page text | `页面成功标志已出现` |
| media state | `目标媒体已暂停 / 已播放` |
| element state | `目标控件状态已更新` |
| user confirmed | `你已确认页面结果` |

URL 去掉 query、hash、userinfo；不显示 criterion ID、digest、target ID 或原始页面正文。

当前契约没有 page-text 原文，UI 不得伪造“检测到某句具体成功文案”。

### Strict verified predicate

必须同时满足：

- Task `completed`；
- 当前 Round `completed`；
- receipt 的 task/round ID 匹配；
- required criteria 非空；
- 每个 required criterion 都存在同 Round、同 target、`passed=true` 的 evidence。

否则显示 `结果待验证` 或 `还缺少页面证据`，不显示绿色完成、评分或保存 Skill。

### Round continuation

- 首次完成时结果卡展开，步骤与回执折叠。
- 不按定时器自动压缩。
- 用户发送 follow-up 后，旧 Round 压缩为 48–56px verified summary，新 Round 成为唯一展开主面。
- 旧 receipt、评分和 Skill 入口仍可从摘要展开访问。

评分不改变 receipt；保存 Skill 只有在 ack 成功后才关闭表单并清空输入。

## Accessibility and focus

- 运行状态变化：`role="status" aria-live="polite"`，不得对每个 `updatedAt` 重复朗读。
- 结果不确定：一次性 `role="alert"`。
- 异步完成默认不抢焦点；只有焦点所在控件被卸载时移动到完成标题。
- 审批没有全局 Enter、Cmd/Ctrl+Enter 或单键快捷键；Enter/Space 只激活聚焦按钮。
- Escape 不等同拒绝，只关闭详情或返回 composer。
- 评分使用原生 radio group / fieldset + legend。
- Skill 表单打开聚焦首字段；保存/取消后返回触发按钮。
- 所有交互状态都有 2px `focus-visible`，offset 2px；不能只靠颜色表达状态。

## Contract changes

### P0 — UI correctness without a broad runtime rewrite

- 移除假进度；只有 observed 计完成。
- Header 保留唯一总状态；任务卡去重。
- 任务优先布局和固定 composer。
- 运行中启用现有 follow-up。
- 审批卡前置、步骤折叠、结构化本地文案；禁止显示英文 summary。
- approve/reject 增加本地 pending，防双击。
- 完成态使用严格 receipt + evidence predicate。
- URL evidence 做安全路径显示；page-text 使用保守类型文案。
- 评分变为紧凑 radio；Skill 降为次级并等待 ack。
- 新增 focus-visible、live region 与 reduced-motion。

### P1 — Product contract needed for the full experience

```ts
type TaskActivityPhase =
  | 'observing'
  | 'planning'
  | 'preparing'
  | 'acting'
  | 'verifying'
  | 'recovering';

interface TaskActivity {
  phase: TaskActivityPhase;
  phaseStartedAt: number;
  lastActivityAt: number;
  attemptId?: string;
  actionName?: string;
  retry?: {
    index: number;
    limit: number;
    reason: 'target_changed' | 'action_not_effective' | 'verification_mismatch' | 'temporary_runtime_error';
  };
  knownTotalSteps?: number;
}

interface PersistedApprovalDescriptor {
  actionKind: 'submit_form' | 'send_message' | 'purchase' | 'delete' | 'publish' | 'permission_change' | 'other';
  targetOrigin: string;
  targetDigest: string;
  affectedFieldCount?: number;
  expectedResultKind: 'page_text' | 'url' | 'element_state' | 'user_confirmed';
  proposedAt: number;
  reasonCode?: 'target_changed' | 'revalidate_failed' | 'interrupted';
}
```

并补充：

- Approval `invalidated` 与 `approval_target_changed` reason。
- `recheck_target`、`resolve_commit_outcome`、可选 `recheck_completion` command。
- CommandAck 到 UI 的 pending/result 映射。
- receipt `schemaVersion`、`verdict`、approved external commit IDs。
- 脱敏 `EvidenceDisplay`，只含 criterion kind、source、observedAt、sanitized target/path。
- Skill save eligibility、saved skill ID 和 source round/receipt provenance。
- `argsDigest` 对值字段先规范化或改用设备本地密钥 HMAC，避免低熵值被字典枚举。

## Implementation map

| File | Responsibility |
|---|---|
| `pages/side-panel/src/components/TaskStatusCard.tsx` | 三态布局、操作、焦点、历史 Round 摘要 |
| `pages/side-panel/src/presentation/task-loop-ui.ts` | 纯 view-model、严格 predicate、证据与文案映射 |
| `pages/side-panel/src/SidePanel.tsx` | shell 滚动、follow-up、command ack、一次性完成宣告 |
| `pages/side-panel/src/components/ChatInput.tsx` | 连续控制 placeholder、去重 Stop |
| `pages/side-panel/src/design/chijie-tokens.css` | 浅色/品牌绿/语义色/motion tokens |
| `pages/side-panel/src/design/chijie-components.css` | 任务卡、审批、证据、focus、reduced motion |
| `packages/storage/lib/task/types.ts` | activity、approval、evidence、receipt、command contract |
| `chrome-extension/src/background/task/action-dispatcher.ts` | phase、结构化 effect、目标变化、隐私摘要 |
| `chrome-extension/src/background/task/manager.ts` | approval 生命周期、receipt predicate、uncertainty、Skill ack |
| `packages/i18n/locales/*/messages.json` | 所有用户文案；不编辑生成的 `packages/i18n/lib/**` |

不要求引入 Anime.js 依赖。先用现有 CSS/React 完成机制；只有布局协调复杂到 CSS 不足时，再单独评估新依赖。

## Acceptance

### Shared

- 430×921 CSS px 首屏能同时看到目标、当前状态专用区和 composer。
- 320px / 200% zoom 无横向滚动。
- 无 raw machine terms 或敏感值。
- 页面中只有一个“停止任务”。
- keyboard、focus-visible、screen reader 和 reduced-motion 均有证据。

### Running

- no attempt、proposed、executing、observed、blocked-running 都有正确人话状态。
- 无 `knownTotalSteps` 时 DOM 没有百分比或 `x/x`。
- 只有 observed 显示勾；approved 显示待执行。
- composer 可发送 follow-up，新 Round 不改写旧 Round。
- blocked-running 为琥珀恢复态，failed 才红。

### Approval

- waiting 状态审批卡首屏可见，步骤默认折叠。
- 批准前提交数 0；批准一次后严格 1。
- 双击只发送一个 approve command，无 raw stale-revision 聊天噪音。
- target digest 变化时提交数仍 0，旧批准显示失效。
- executing/uncertain 无自动重试。
- 中文界面不出现英文 summary 或 `click_element`。

### Verified

- receipt 缺失、跨 task/round 或 required evidence 不全时不显示 verified、评分或 Skill。
- 完成态无 `1/1` 进度。
- 至少一条安全页面证据首屏可见；receipt 默认折叠。
- 评分不改写 receipt。
- Skill 未确认保存前不关闭表单；失败保留输入。
- follow-up 后旧 receipt 仍以压缩 Round 可见。

### Visual evidence set

新的 QA 至少保存：

- `running-observing.png`
- `running-executing.png`
- `running-verifying.png`
- `running-recovering.png`
- `paused.png`
- `approval-waiting.png`
- `approval-submitting.png`
- `approval-target-changed.png`
- `commit-outcome-uncertain.png`
- `verified-complete.png`
- `verified-follow-up-round.png`
- `reduced-motion.png`

每张新截图与当前真实截图在相同 viewport、相同状态下并排比较；截图本身不等于 QA。

## Reusable design knowledge

Scion 是 UI Motion Lab 的第一个完整复利闭环：

```text
作品来源 → 真实截图/录屏 → 交互机制 → 产品问题映射
→ 实现参数与约束 → 同状态验收证据 → 复盘结论
```

每个可复用机制必须记录：Preview、Problem、Mechanism、Constraints、Used in、Outcome。未被真实项目采用和验证的内容仍是候选参考，不升级为模式。
