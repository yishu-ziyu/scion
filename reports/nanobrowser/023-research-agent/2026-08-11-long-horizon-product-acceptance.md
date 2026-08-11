# 021 长程任务 Agent v1 产品级验收

日期：2026-08-11

范围：`docs/product/021-long-horizon-task-agent.md` 当前里程碑 `long_horizon_v1`

正式模型：MiniMax-M3

公共入口：打包后的 Chrome MV3 扩展 `dist/`，真实 side panel 与浏览器页面

## 验收结论

**PASS，带明确边界。**

当前构建已经形成一条可复现的长程 Agent 主流程：用户以自然语言委派多阶段任务，Agent 在 Chrome 中自主执行，侧栏持续展示 Mission、阶段、证据进度、健康状态、下一步和控制入口；任务结束后终态结果继续留在公共侧栏，可由 evaluator 和用户检查；正式 MiniMax-M3 `021-LH-01..03` 全矩阵为 **3/3 verified_pass**，`false_complete=0`、`wrong_tab=0`、`unapproved_commit=0`。

这不代表所有真实长任务都已交付。Living Reader 正式任务仍停在 `interrupted`，当前为合格用户讨论 `76/80`、产品 `26/30`，还缺完整能力证据矩阵和飞书双回读。该任务已交还用户，未经明确授权未恢复。

## 本轮发现并闭环的问题

### 终态结果卡片消失

首次用当前构建运行完整 `long_horizon` 公共矩阵时，三个任务都已完成实际页面工作，但 side panel 在任务进入 terminal 状态后隐藏了 `[data-testid="task-status"]`。evaluator 因无法继续观察 `completed` 而超时，得到 0/3。

证据：

- `../eval/2026-08-11-173428-eval-summary.md`
- `../eval/2026-08-11-173428-eval-matrix.csv`

修复后，当前任务的 `completed`、`failed`、`cancelled` 结果继续保留在主任务面；只有显式新建会话才清空当前快照。活动状态判断仍只包含 running、paused、waiting、interrupted，终态不会被当成正在执行，也不会被自动恢复。

聚焦复验：

- LH-03：`../eval/2026-08-11-174857-eval-summary.md`，1/1 verified_pass。
- LH-02：`../eval/2026-08-11-175149-eval-summary.md`，1/1 verified_pass。
- LH-01：`../eval/2026-08-11-175251-eval-summary.md`，1/1 verified_pass。

最终完整复验：

- `../eval/2026-08-11-175507-eval-summary.md`
- `../eval/2026-08-11-175507-eval-matrix.csv`
- 结果：**3/3 verified_pass**。

### evaluator 清理挂起警告

完整复验同时发现，没有本地 fixture server 的任务仍创建了一个永不 resolve 的可选关闭 Promise，Node 报 `unsettled top-level await`。清理逻辑已改为只有 fixture server 实际存在时才等待 `close`。修复后的 3/3 完整复验没有该警告。

## 021 明确要求到检查的映射

| 021 要求 / 公共输出 | 具体检查 | 实际观察 | 结论 |
|---|---|---|---|
| 一次自然语言委派 | LH-01、LH-02、LH-03 通过侧栏 composer 各提交一次完整目标 | 三个任务均由一次 goal 启动，没有逐动作提示用户 | PASS |
| Agent 给出并持久化 Mission/Plan | Mission/Plan 单测、TaskManager 集成测试、Living Reader 真实任务 reload | 稳定 Mission、阶段、验收 Gate 与检查点在 reload 后保留 | PASS |
| 跨页面、多阶段自主执行 | LH-01 从 Wikipedia 门户进入 AI 条目；LH-02 从 example.com 离开并进入 Web browser 条目 | 最终 URL 与页面正文同时满足 verifier；没有在门户、中间页或普通 wiki 页提前完成 | PASS |
| 信息读取、整理和交付 | LH-03 读取本地产品表，要求至少 5 行 `name,price,rating` 并找出最贵商品 | side panel 最终回复同时包含表头与 `Beta Mechanical Keyboard` | PASS |
| 任务级授权，不做逐动作审批 | `action-dispatcher.test.ts`、`manager.test.ts` 外部提交路径；正式矩阵 `unapproved_commit=0` | 任务内动作直接执行；审批不再是主状态或模态阻塞 | PASS |
| 超范围风险与敏感输入仍受保护 | SecurityGuardrails、隐私门与既有 022 trace 扫描 | 敏感值不进入持久 trace；本轮未削弱该边界 | PASS |
| 中间和最终结果必须可观察 | 公共 evaluator 同时读取 side panel terminal status 与目标页面/回复证据 | 三个任务只有在 `completed` 可见且 URL、页面文本或回复内容通过时才记 verified_pass | PASS |
| 模型说完成不算完成 | `waitCompleted` + `verifyResult`；既有 022 verifier/artifact gates | 候选完成若证据不符会记 false_complete；本轮 false_complete=0 | PASS |
| 侧栏几秒内回答目标、阶段、进度、健康、成果、是否需介入 | 真实 Chrome 430px、320px、200% 验收；progress-console 逐项矩阵 | 稳定 Mission、5 阶段、76/80、原始/去重说明、健康和下一步首层可见 | PASS（中文路径） |
| 有可信总量才显示计数，不伪造百分比 | evidence-space 与 presentation 测试 | Living Reader 使用持久证据计数；通用无 criteria 阶段不生成虚构 x/y | PASS |
| 当前活动服务于阶段，原始动作进入审计层 | presentation 测试与真实 Living Reader 控制台 | 当前活动含目的；546 条操作只留在折叠审计信息 | PASS |
| 暂停、等待、失败与运行视觉互斥 | 状态矩阵覆盖 running、paused、interrupted、waiting_user、failed、cancelled、completed | 非运行态不显示陈旧活动或计时器；终态保持可检查但不算 active | PASS |
| 用户可暂停、继续、调整、追问、停止 | TaskManager 控制集成测试；真实侧栏点击“调整方向” | 调整只聚焦 composer 并预置草稿，不隐式恢复；继续与停止入口可见 | PASS（真实任务未点击继续/停止） |
| 中断后从计划恢复而非从零开始 | Living Reader 真实 reload、checkpoint 与 manager recovery 测试 | 76/80、26/30、Mission 和下一步保持；恢复执行因用户所有权未实际触发 | PASS（持久化）；恢复执行受授权边界限制 |
| 最终成果在任务结束后仍可检查 | terminal card 修复 + 完整公共矩阵 | completed 后 `[data-testid="task-status"]` 和 completion receipt 不再消失，evaluator 成功读取终态 | PASS |
| 生产打包路径可运行 | `pnpm build` 后从 `dist/` 加载扩展执行正式矩阵 | Chrome for Testing 成功加载 MV3 扩展并完成三项任务 | PASS |
| 官方评分使用 MiniMax-M3 | `eval:matrix` 环境与生成报告 | 三项均记录 provider=minimax、model=MiniMax-M3、prompt=`chijie-control-v0.3.0` | PASS |

## 真实公共任务结果

| Task | 真实路径 | 验证条件 | 最终结果 |
|---|---|---|---|
| 021-LH-01 | `wikipedia.org` 门户 → 搜索/导航 → AI 条目 | URL 包含 `/wiki/Artificial_intelligence` 且正文含 `Artificial intelligence` | verified_pass |
| 021-LH-02 | `example.com` → 跨站打开 Web browser 条目 | URL 包含 `/wiki/Web_browser` 且正文含 `web browser` | verified_pass |
| 021-LH-03 | 产品列表 fixture → 表格提取 → 结论 | 回复含 `name,price,rating` 与 `Beta Mechanical Keyboard` | verified_pass |

汇总：`3/3 verified_pass`，`false_complete=0`，`wrong_tab=0`，`unapproved_commit=0`。

## 进度控制台验收

完整 UI 证据见：`2026-08-11-progress-console-e2e.md`。

已通过：

- 中文真实侧栏 430px、320px 和 200% 等价窄视口。
- 无横向滚动，主要控制高度 44px。
- 稳定 Mission、证据计数、阶段、健康、下一步、成果和控制入口。
- `调整方向` 真实点击后只进入编辑，不恢复任务。
- 中断态 reload 后检查点和计数仍在。
- terminal completed/failed/cancelled 结果现在继续可见。

## 回归与打包

本轮最终门全部通过：

- side-panel：`13` 个测试文件、`125` 个测试通过。
- chrome-extension：`62` 个测试文件、`525` 个测试通过。
- workspace type-check：`12/12` 个任务通过。
- workspace lint：`12/12` 个任务通过。
- production ready：`8/8` 个任务通过。
- production build：`5/5` 个任务通过，生成 side-panel、options、content 与 chrome-extension `dist/` 产物。
- 打包扩展上的 MiniMax-M3 `long_horizon` 完整矩阵：`3/3 verified_pass`。

非阻塞警告仅包括过期的 browser/browserslist 数据、Tailwind config 缺少 `type: module` 和 Vite browser compatibility 提示；没有测试、类型、lint 或 build 失败。

## 未完成边界

1. **Living Reader 不是完成状态。** 正式交付仍缺 4 条合格用户讨论、4 个产品、恰好三个能力的完整 `2+1+1` 证据矩阵、飞书研究表与决策文档双回读。
2. **Living Reader 恢复执行受用户所有权边界阻塞。** 当前只验证了检查点保存和控制台映射，没有擅自夺回或恢复用户任务。
3. **英文真实侧栏路径未通过。** 生产 i18n 当前在 `i18n-prod.ts` 固定 `zh_CN`，没有真实英文产品入口；中文主路径已通过。
4. **上下文压缩仍是确定性 archive。** 不是 LLM 语义摘要，与 021 当前缺口一致。
5. **Observation Diff 仍默认关闭。** 022 的 live payload reduction 为 0%，因此保持 OFF。它不阻塞 021 默认长程流程，但阻塞 022 独立 promotion gate。

## 产品判断

`long_horizon_v1` 的核心产品主路径已经被当前真实公共接口证明：一次委派、自主多阶段执行、可理解进度、连续控制、终态结果持续可见、浏览器证据验证后才完成。

下一阶段不应重新回到单动作浏览器演示或批准弹窗。应继续做两件事：第一，在获得 Owner 授权后完成 Living Reader 的真实 80/30/3 能力/飞书交付；第二，把当前已验证的控制台扩展到更多真实长任务、英文产品路径和更强的中断恢复体验。
