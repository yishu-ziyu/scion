# 023 长程任务进度控制台真实侧栏 E2E

日期：2026-08-11
环境：ego-browser 独立任务空间 15（首轮截图与窄视口验收）及任务空间 18（最终构建复验）；真实 Chrome MV3 扩展侧栏；中文主路径。
任务：`0708c02a-2a12-4e3e-8217-6fc7b5f7015e`
任务状态：`interrupted`，验收期间未恢复执行、未停止任务、未改写证据空间。

## 验收目标

验证 `design/008` 的可信长程任务控制台是否能在真实侧栏中让用户快速回答：目标是什么、进行到哪里、为什么是这个数字、当前是否仍在运行、下一步是什么、我可以怎样干预。

本报告只验收进度控制台和 `023-LR-01` 的展示映射，不代表 Living Reader 正式任务已经完成。

## 目标收敛后的解释复核

在 Owner 明确产品目标以前，执行中曾作出两个暂时性判断：第一，把当前优先级理解为尽快继续并完成 Living Reader 调研；第二，把“可视化”理解为对已有任务状态与日志的展示改良。Owner 随后明确，真正优先级是先建立 Chrome 侧栏中的可信任务控制台，并在关键阶段快速外化 Agent 的 Mission、里程碑、事实、健康度、下一步与控制结构。

按最终目标回查此前工作：长程技能隔离、拒绝完成后的重试保护、证据空间与恢复检查点仍直接服务于“自主执行 + 真实进度 + 可恢复”，没有引入逐动作审批，也没有把聊天重新提升为任务主界面。进度控制台的设计与实现发生在目标确认之后。未通过项也不被掩盖：Living Reader 最终研究交付尚未完成；生产 i18n 当前固定为简体中文，因此英文真实侧栏路径仍未通过。

## 事实口径

- 稳定 Mission：`Living Reader 下一阶段能力决策`。
- 最终交付：恰好三个能力、完整证据矩阵、飞书研究表与决策文档回读。
- 用户讨论原始记录：`91` 条。
- 合格用户讨论：`76/80` 条。
- 未计入：`15` 条，界面明确解释为来源过滤或去重。
- 合格产品：`26/30` 个。
- 当前阶段：用户研究，`1/5` 阶段。
- 中断后的下一步：补足 `4` 条合格用户讨论证据。

以上进度来自持久证据空间的正式计数，不使用聊天文案、页面数、动作数或模型自报作为目标进度。

## 真实 Chrome 观察

### 430 CSS px

- `documentElement.clientWidth = 430`，`scrollWidth = 430`，无横向滚动。
- 首屏可见稳定 Mission、五阶段结构、当前阶段、`76/80` 合格数、`91` 原始数、`15` 条未计入说明、中断健康状态和下一步。
- `继续`、`调整方向`、`停止任务` 位于任务控制台首层。
- 完整 `546` 条操作记录降为折叠审计信息，不参与目标进度。
- 中断状态只显示“运行已中断，检查点已经保存”，不显示陈旧的“正在读取”、运行点或计时器。
- composer 上方使用“当前页面”，没有把下一条指令的页面上下文冒充为 Agent 当前活动。

证据：[430px 截图](./progress-console/2026-08-11-progress-console-430px.png)

### 320 CSS px

- `documentElement.clientWidth = 320`，`scrollWidth = 320`，无横向滚动。
- 三个控制按钮均可见，单个按钮约 `83 × 44` CSS px。
- 中文长文案正常换行，任务结构没有被压成不可读的横向布局。

证据：[320px 截图](./progress-console/2026-08-11-progress-console-320px.png)

### 200% zoom 等价视口

- 使用 `215 × 450` CSS px、`deviceScaleFactor = 2` 验证 200% 等价窄视口。
- 无横向滚动。
- 控制按钮采用紧凑布局，单个按钮约 `48 × 44` CSS px，仍满足至少 40px 的主要交互目标。
- 滚动到控制区后三个操作均完整可见。

证据：[200% 控制区截图](./progress-console/2026-08-11-progress-console-200pct-controls.png)

## 真实交互验收

对真实侧栏执行一次 `调整方向` 点击，并在点击后读取页面状态：

```json
{
  "activeTag": "TEXTAREA",
  "textareaFocused": true,
  "textareaDisabled": false,
  "interruptedStillVisible": true,
  "runningVisible": false,
  "value": "我想调整："
}
```

结论：点击只解锁并聚焦 composer，预置本地草稿“我想调整：”，没有自动恢复任务，没有把任务切换为运行，也没有发送方向调整命令。用户仍需主动编辑并提交。

验收期间没有点击 `继续` 或 `停止任务`。

最终构建完成后，在保留同一 Living Reader 任务与证据空间的任务空间 18 重新加载扩展侧栏并复验：`clientWidth = scrollWidth = 430`，Mission、`76/80` 与三个控制按钮仍可见，状态仍为中断且无“正在运行”。再次点击 `调整方向` 后 textarea 获得焦点、可编辑并预置“我想调整：”，任务没有恢复；刷新后草稿清空，任务仍保持中断。

## Gate 判断

| Gate | 结果 | 证据 |
|---|---|---|
| G21-V1 稳定目标 | PASS | follow-up 没有覆盖 Mission；控制台持续显示稳定目标 |
| G21-V2 真实进度 | PASS | 同时显示合格 `76/80`、原始 `91` 与 `15` 条未计入原因 |
| G21-V3 结果阶段 | PASS | 五阶段由证据 Gate 驱动；动作数只保留为折叠审计 |
| G21-V4 状态一致 | PASS | 中断状态无实时活动、计时器或“正在读”；composer 仅标“当前页面” |
| G21-V5 健康可懂 | PASS | 显示检查点已保存、最近有效进展和继续后的明确下一步 |
| G21-V6 成果可见 | PASS（当前切片） | 首层显示最新成果与数量；操作记录可展开审计 |
| G21-V7 连续控制 | PASS（中断态） | 继续、调整、停止可见；调整方向真实点击通过且不隐式恢复 |
| G21-V8 真实侧栏 | PARTIAL | 中文 430px、320px、200% 真实 Chrome 通过；英文真实 Chrome 主路径本次未运行 |
| G23-9 可视化运行 | PASS（控制台切片） | Mission、阶段、证据、计数口径、健康、下一步和控制入口一致可见 |

## 最终需求到检查的逐项映射

| 明确要求 / 公共输出 | 检查路径 | 实际观察 | 结论 |
|---|---|---|---|
| 稳定 Mission，follow-up 不覆盖 | presentation 测试读取原始 instruction；真实侧栏读取标题；方向调整点击后复读 | 始终为“Living Reader 下一阶段能力决策”；草稿与状态变化未改写标题 | PASS |
| 方向调整是独立、带时间的事件 | TaskManager 集成测试提交 `changeType=direction_change`；presentation 测试投影事件 | 新 round 保存 `changeType`、`createdAt`；侧栏存在独立“方向已调整”区域 | PASS |
| 合格数来自持久证据并解释原始数 | evidence-space + presentation 测试；真实侧栏读取 | `76/80`、原始 `91`、未计入 `15` 同时出现，下一步为补足 4 条 | PASS |
| 无可信总量不伪造百分比 | generic presentation 测试 | 无 criteria 的通用阶段输出空 Gate，不产生虚构 `x/y` | PASS |
| 里程碑由 Gate/产物而非动作数推进 | presentation 决策矩阵与交付回读测试；真实侧栏比较 5 阶段与 546 条审计 | 三个能力但证据矩阵不完整时决策阶段仍不通过；动作记录只在折叠审计层 | PASS |
| 运行状态视觉互斥 | 状态矩阵测试覆盖 waiting、inputs-required、failed、cancelled、completed；暂停/中断、运行另有测试；真实中断侧栏复验 | 所有非运行状态均无 `currentActivity`；中断侧栏无“正在运行”、读页面或计时器 | PASS |
| 当前动作包含目的，且当前页面不冒充活动 | running presentation 测试；真实中断侧栏读取 composer kicker | 运行投影为“打开 Zotero 官网 · 推进产品研究”；中断只显示 composer“当前页面” | PASS |
| 健康度可判断推进、换路、放缓、需要用户、暂停、失败、完成 | presentation 健康矩阵、blocked attempt 与 8 分钟陈旧阈值测试 | 分别投影 advancing、recovering、slow、needs_user、paused、failed、complete；陈旧任务不假装正常 | PASS |
| 成果与产物可检查 | presentation 测试注入最新证据和飞书回读产物；组件链接输出；真实侧栏观察成果区 | 最新两条成果可见；已回读产物映射为 verified 链接；当前 Living Reader 尚无正式飞书产物 | PASS（能力成立，任务产物未完成） |
| 暂停/继续/调整/追问/停止连续控制，无逐动作审批 | TaskManager pause/follow-up/direction tests；UI acceptance；真实侧栏调整点击 | 三个中断态按钮可见；调整只聚焦 composer、不隐式恢复；源码与 UI 无“批准一次” | PASS（未对真实任务点击继续/停止） |
| 430px、320px、200% zoom、中文长文案、40px 目标 | 真实 Chrome 尺寸与 DOM 测量；CSS reduced-motion 与 focus 测试 | 三种视口均无横向滚动；按钮高度 44px；reduced-motion 关闭滚动动效 | PASS |
| 英文真实 Chrome 主路径 | 检查生产 i18n 入口和真实产品路径 | `i18n-prod.ts` 明确固定 `zh_CN`，当前没有可进入英文产品路径 | **BLOCKED / 未通过** |
| 中断后保存并可恢复 | 真实扩展 reload 前后读取同一任务；TaskManager interrupted follow-up 集成测试 | Mission、`76/80`、`26/30`、检查点在 reload 后保持；未发送继续命令 | PASS（保存）；恢复执行待 Owner 授权 |
| 最终完成必须有浏览器证据 | completion receipt 测试与当前真实任务状态 | 当前仍诚实显示 interrupted，没有因模型文本或部分配额显示完成 | PASS（诚实未完成） |

真实 Chrome 的最终构建检查发生在首个功能提交前；随后完整验收发现并修复 lint gate，最终 production build 再次通过。后续改动仅为静态 type import、等价 decision draft 构造、测试 lint 修复与状态矩阵测试，没有改动侧栏 DOM、CSS、交互或持久状态。任务空间 18 按保留策略交还用户，后续不能在未获明确授权时夺回控制；因此没有再次点击真实任务的继续或停止来规避这一安全边界。

## 回归验证

最终实现已执行：

- side-panel：`13` 个测试文件、`125` 个测试全部通过，其中状态矩阵显式覆盖 waiting、inputs-required、failed、cancelled、completed、paused、interrupted、running、recovering 与 slow。
- chrome-extension：`62` 个测试文件、`525` 个测试全部通过。
- workspace `pnpm type-check`：`12/12` 个任务通过。
- workspace `pnpm lint`：`12/12` 个任务通过；仅保留依赖数据陈旧和 Tailwind 配置模块类型等非阻塞警告。
- workspace `pnpm build`：ready `8/8`、生产 build `5/5` 通过，side-panel、options、chrome-extension 均生成 `dist/` 产物。

独立 P4 评审最初指出三个缺口：方向调整缺少可持久审计事件、决策 Gate 只检查三个能力的数量、无运行尝试时健康状态可能长期显示推进中。实现补齐了方向调整的类型与时间戳及可视事件、改用完整 `researchDecisionReady` 矩阵校验，并为无最近尝试的运行任务加入陈旧阈值。聚焦复审结果为 **PASS**。

## 当前判断

可信进度控制台的中文真实侧栏主路径已经建立。它把长程任务从“聊天和 546 条操作日志”提升为稳定 Mission、证据驱动里程碑、互斥运行状态和可控恢复入口。

这不等于 `023-LR-01` 完成。正式任务仍缺：合格用户讨论 `4` 条、合格产品 `4` 个、恰好三个能力的完整 `2+1+1` 证据矩阵，以及飞书研究表和决策文档的双回读。任务继续保持 `interrupted`，待 Owner 决定是否恢复。

## 后续公共接口闭环：终态结果持续可见

在本报告初次收口后，使用打包扩展运行官方 MiniMax-M3 `TASK_SET=long_horizon` 暴露了一个真实集成缺口：任务实际完成后，side panel 会隐藏 terminal task card，导致用户和 evaluator 都无法继续检查最终状态。首次完整运行因此为 `0/3`，三个失败均为 terminal status 不可观察导致的超时，而不是页面任务未执行。

修复后，当前会话中的 `completed`、`failed`、`cancelled` 结果继续保留；这些状态不会被视为 active，也不会自动恢复。显式新建会话仍会清空当前快照。聚焦 LH-01、LH-02、LH-03 均通过，最终完整 MiniMax-M3 矩阵为 `3/3 verified_pass`，`false_complete=0`、`wrong_tab=0`、`unapproved_commit=0`。

完整证据与逐项 021 映射见：`2026-08-11-long-horizon-product-acceptance.md`。最终矩阵见：`../eval/2026-08-11-175507-eval-summary.md`。
