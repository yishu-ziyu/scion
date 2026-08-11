# 023-LR-01 Living Reader 端到端验收状态

日期：2026-08-11

被测构建：`74bab09`（包含进度控制台与终态结果可见性证据）

正式任务：`023-LR-01`

真实任务 ID：`0708c02a-2a12-4e3e-8217-6fc7b5f7015e`

## 最终判断

**正式任务未通过，状态为 acceptance_blocked。**

系统级研究机制、证据计数、去重、候选完成拒绝、决策矩阵、飞书回读门、恢复策略、进度控制台和生产打包均已验证；真实任务也留下了可观察的持久进度。但正式交付仍缺少 4 条合格用户讨论、4 个产品、恰好三个能力的真实证据矩阵与飞书双回读，因此不能标记完成。

当前真实任务空间已交还用户，任务保持 `interrupted`。继续执行会改变真实研究证据和外部飞书交付，必须先获得 Owner 对该任务空间的明确授权。本轮没有夺回、恢复或停止任务。

## 真实公共接口观察

证据来源：`2026-08-11-progress-console-e2e.md` 及其真实 Chrome 截图。

| 公共输出 | 真实观察 | 判断 |
|---|---|---|
| 稳定 Mission | `Living Reader 下一阶段能力决策` | PASS |
| 阶段结构 | 理解项目、用户研究、产品研究、交叉验证与决策、飞书交付与回读 | PASS |
| 当前阶段 | 用户研究，界面显示 `1/5` 阶段 | PASS |
| 用户证据进度 | 原始记录 91 条，合格且去重后 `76/80`，15 条未计入 | **未达标** |
| 产品证据进度 | `26/30` | **未达标** |
| 当前健康 | `interrupted`，检查点已保存，无陈旧运行活动和计时器 | PASS |
| 下一步 | 补足 4 条合格用户讨论，然后补足 4 个产品 | PASS |
| 用户控制 | 继续、调整方向、停止任务可见；真实点击调整方向只聚焦 composer，不隐式恢复 | PASS |
| 正式交付物 | 没有本任务的飞书研究表 URL、决策文档 URL或回读结果 | **未达标** |
| 最终状态 | 保持 interrupted，没有把部分进度冒充完成 | PASS，诚实未完成 |

真实侧栏在 430px、320px、200% 等价窄视口均无横向滚动。当前构建的 terminal completed/failed/cancelled 结果也已通过独立 MiniMax-M3 公共矩阵验证会持续可见。

## G23-1 至 G23-9 逐项映射

| Gate | 明确要求 | 检查与证据 | 实际结果 | 状态 |
|---|---|---|---|---|
| G23-1 项目理解 | 读取仓库、记录 HEAD、能力地图覆盖五种状态，已实现判断有代码/测试/运行证据 | 真实侧栏显示仓库依据 `1/1` 已达标；证据空间支持 repository 类型；当前报告集没有仓库 HEAD、完整文件结构、Issue/提交范围和五态能力地图导出 | 项目理解阶段有部分持久依据，但正式输出不完整 | **PARTIAL / 未通过** |
| G23-2 用户证据 | 至少 80 条合格去重用户讨论，失败来源不计数 | 真实侧栏读取正式计数；`evidence-space.test.ts` 检查来源绑定、正文依据、搜索摘要排除、去重与独立讨论计数 | 真实值 `76/80`，差 4 条 | **FAIL** |
| G23-3 产品证据 | 至少 30 个实际打开研究的产品，重要候选含独立用户证据 | 真实侧栏读取正式计数；证据测试排除讨论帖冒充产品，并按产品身份去重 | 真实值 `26/30`，差 4 个；没有最终候选的重要产品交叉证据导出 | **FAIL** |
| G23-4 交叉验证 | 每个最终能力 2 用户 + 1 产品 + 1 代码依据，反证并列，证据不足标假设 | `researchDecisionReady` 与 evidence-space 测试验证 2+1+1 和 contradictions；缺一条用户证据会拒绝 | 机制 PASS；真实任务没有被接受的三个能力证据矩阵 | **FAIL（任务输出）** |
| G23-5 产品决策 | 恰好三个能力，每项回答七问，并明确暂不做项 | `putResearchDecisionInSpace` 测试验证恰好三个能力、七个字段、deferred 和 contradictions | 机制 PASS；真实任务没有正式被系统接受的决策 | **FAIL（任务输出）** |
| G23-6 飞书交付 | 研究表与文档创建成功，字段、计数、链接、第一屏重新读取 | `putResearchDeliveryInSpace` 测试验证飞书域 URL、研究表字段与行数、文档“做什么/为什么/暂不做”观察文本；`researchDeliveryReady` 要求双产物 | 机制 PASS；真实任务没有两个 URL，也没有回读 | **FAIL** |
| G23-7 长程可靠性 | 中断恢复、不重复计数、单来源失败换路，只有验证码/付款/授权/不可逆操作等等待用户 | 真实 reload 后 Mission 与 76/80、26/30 保持；checkpoint 测试覆盖 quotas、236 work cycles、search/unavailable/private dashboard；manager 测试覆盖 max_steps 续跑、单来源 action_failed 换路、paused 不恢复、running/interrupted/recoverable failed 恢复 | 机制与保存 PASS；真实恢复执行未运行，因为任务空间已属用户 | **PARTIAL / acceptance_blocked** |
| G23-8 无虚假完成 | 任一计数、决策门或飞书回读未通过不得完成 | manager 测试以 12/80、4/30 的 candidate_complete 验证确定性拒绝；真实侧栏仍显示 interrupted | 部分配额和模型文本没有绕过完成门 | **PASS** |
| G23-9 可视进度 | 五阶段、80/30、原始/未计入、活动目的、健康、下一步、交付物；非运行态无陈旧活动 | 真实 Chrome 430px/320px/200% 截图、调整方向点击；presentation 状态矩阵与 terminal public eval | 中文主路径全部可读、互斥且可控 | **PASS（中文路径）** |

## 正式验收输出清单

| product/023 要求的输出 | 当前资产 | 状态 |
|---|---|---|
| 任务快照 | 真实任务 ID 与侧栏快照；本地私有备份不入 git | PARTIAL |
| 用户可见进度快照 | 三种视口截图与 DOM 测量 | PASS |
| 阶段状态 | 五阶段、当前阶段和健康状态在侧栏可见 | PASS |
| 去重后的证据空间导出 | 只有真实计数与最小 E2E，没有本任务完整 76+26 记录导出 | FAIL |
| 失败来源与替代路径 | 机制测试覆盖，但没有本任务完整失败来源清单 | FAIL |
| 三个能力覆盖矩阵 | 无 | FAIL |
| 飞书研究表 URL | 无 | FAIL |
| 飞书决策文档 URL | 无 | FAIL |
| 飞书回读结果 | 无 | FAIL |
| 最终任务回执 | 无，且按 G23-8 不应生成 | 正确未生成 |

## 非破坏性回归

执行命令覆盖证据空间、研究 checkpoint、TaskManager、侧栏投影、状态/交互验收、类型、lint 和生产打包。

结果：

- chrome-extension 定向：3 个测试文件，`71/71` 通过。
- side-panel 定向：3 个测试文件，`65/65` 通过。
- workspace type-check：`12/12` 通过。
- workspace lint：`12/12` 通过。
- production ready：`8/8` 通过。
- production build：`5/5` 通过。

重点边缘路径：

- 搜索结果摘要不计数。
- Notebook 私有 dashboard 不计入用户材料。
- 讨论帖不能冒充已研究产品。
- 未实际打开的来源和过短 raw basis 被拒绝。
- 同一产品换文案重放仍只计一个产品。
- 同一讨论的重复记录不增加计数，不同独立案例可分别计数。
- 有实质内容的页面离开前必须先持久记录。
- 不可用页面允许换路，不强制写入坏来源。
- max_steps、no_progress、action_failed 等可恢复失败进入下一 work cycle。
- candidate_complete 在 80/30、决策或双回读未满足时被拒绝。
- 显式 paused 的研究任务 reload 后保持 paused。
- terminal 结果可见但不会被当作 active 自动恢复。

## 为什么本轮停在 acceptance_blocked

系统已经具备继续完成任务的主要执行和验证机制，但真实执行空间属于用户，并且剩余动作会继续浏览真实来源、写入证据空间、创建或修改飞书资产。这些不是只读验收动作。未经明确授权夺回该任务会违反用户控制边界。

因此当前正确状态不是“任务完成”，也不是“系统失败”，而是：

```text
implementation_mechanisms: PASS
public_progress_console: PASS
formal_023_LR_01_delivery: FAIL / incomplete
resume_execution: BLOCKED on explicit Owner authorization for the retained task space
```

获得授权后的唯一完整完成路径：从当前 checkpoint 继续补到 `80/80` 和 `30/30`，记录仓库 HEAD 与能力地图，提交恰好三个能力的 2+1+1 七问矩阵，创建并重新打开飞书研究表与决策文档，保存完整证据导出和最终 receipt，再按 G23-1..9 复验。
