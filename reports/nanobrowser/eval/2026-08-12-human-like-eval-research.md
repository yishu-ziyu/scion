# 持节 Human-like EVAL 研究与落地协议

**日期：** 2026-08-12

**范围：** Chrome 原生 Side Panel 的长程任务 Agent；对应 `product/019` Harness/Outer Loop、`product/020` eval contract、`product/021` verified delivery

**状态：** RESEARCH COMPLETE / L1 CORE IMPLEMENTATION IN VERIFICATION。本轮范围是确定性结果门、证据 provenance、`Pass^k`、fail-closed runner 与 Owner native acceptance；经真人校准的 simulator、persona × seed 压力层和 50% time horizon 仍属后续 L2/L3 roadmap。在新协议红队、正式矩阵与 Owner native acceptance 全部通过前，本文不声称发布门已完成。

## 决策摘要

持节不应把“仿人类测试”理解成让另一个 LLM 随意扮演用户并打分。可持续的评测必须同时回答三个问题：

1. **结果真的对吗？** 用环境状态、交付物和安全审计做确定性裁决。
2. **交互对真实用户好吗？** 用经过真人行为校准的模拟用户做可重复压力测试，再用真人样本检查模拟器是否仍是可靠代理。
3. **任务变长、重复运行后还可靠吗？** 用 `Pass^k`、恢复能力和人类工时标定的 time horizon 测一致性，不用单次 demo 或 tool-call 数冒充长程能力。

模拟用户是规模化 stress test，不是真人验收的替代品。Outer Loop 只消费开发集的失败簇；冻结 holdout 永不参与调参、prompt 修补或 Skill 生成。

## 一方来源与可采用结论

| 一方来源                                                                                                                                                                                  | 直接贡献                                                                                  | 对持节的采用方式                                                                               | 边界                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| [WebArena](https://arxiv.org/abs/2307.13854)                                                                                                                                              | 可复现、功能完整的网站环境；长程真实任务；以功能正确性验收                                | fixture/public 层必须验证最终环境状态，不以模型“done”评分                                      | 自托管网页不等于用户真实 Chrome、登录态或原生侧栏              |
| [BrowserGym ecosystem](https://arxiv.org/abs/2412.05467) / [WorkArena](https://arxiv.org/abs/2403.07718) / [官方仓库](https://github.com/ServiceNow/WorkArena)                            | 统一 observation/action 环境、重复实验管理、知识工作任务                                  | 统一 task interface、run manifest、trace 和跨任务报告；保留真实知识工作组合任务                | 浏览器 gym 是 runner 基础设施，不替代产品 UI 验收              |
| [τ-bench](https://arxiv.org/abs/2406.12045) / [官方仓库](https://github.com/sierra-research/tau2-bench)                                                                                   | 工具、用户、政策三方动态交互；终态数据库评分；提出 `pass^k`                               | 为澄清、拒绝、确认、纠正等互动编写政策与最终状态 oracle；正式报告 `Pass^k`                     | LLM user 的行为真实性必须另行校准                              |
| [AppWorld-UL](https://arxiv.org/abs/2607.20536)                                                                                                                                           | 用歧义和约束系统地产生 user-in-the-loop 任务；模拟用户有知识边界                          | 为 waiting_user、缺信息、不可行请求和组合澄清建立场景族                                        | 仍是模拟 app/API 世界，不足以证明 Chrome 长尾                  |
| [RealUserSim](https://arxiv.org/abs/2605.20204)                                                                                                                                           | 揭示无约束 LLM user 的形式化偏差，以及手写人格指令的夸大效应；以真实对话行为 profile 校准 | persona 必须来自去标识化真人行为维度，测风格/行动/意图匹配，禁止“你很急躁”式极端提示词代替校准 | 行为相似不自动等于产品判断正确；隐私与域迁移需单独处理         |
| [SimulatorArena](https://aclanthology.org/2025.emnlp-main.1786/)                                                                                                                          | 以真人多轮对话检查模拟器消息行为和 assistant 排名是否与真人一致                           | 上线 simulator 前同时做行为相似度与排名一致性校准，并持续重测                                  | 任一任务上的相关性不能外推到持节全部场景                       |
| [LifeSim](https://arxiv.org/abs/2603.12152)                                                                                                                                               | 长期用户状态、显式/隐式意图和跨场景偏好                                                   | 后续增加跨会话约束、偏好保持和隐式意图诊断；与 session 隔离同时测试                            | 个性化模拟不能成为窥探或持久化敏感用户数据的理由               |
| [OSWorld 2.0](https://arxiv.org/abs/2606.29537)                                                                                                                                           | 小时级、数百步真实工作流；中途信息、隐状态、跨源推理与最终验证                            | 长程集从多站、多 Gate、动态信息和恢复任务扩展；同时报告 binary completion 与 Gate 向量         | 持节是 Chrome 扩展，不必复制 OS 级任务或以步数追求“看起来长”   |
| [METR time horizon 论文](https://arxiv.org/abs/2503.14499) / [研究说明](https://metr.org/blog/2025-03-19-measuring-ai-ability-to-complete-long-tasks/)                                    | 用人类完成任务所需时间解释 Agent 在 50% 成功率处的能力边界                                | 给任务做盲测人类工时标定，按工时 bucket 估计 50% completion horizon                            | 不能把软件任务的结论直接外推到所有浏览器知识工作               |
| [OpenAI Evals 官方仓库](https://github.com/openai/evals) / [evaluation flywheel](https://cookbook.openai.com/examples/evaluation/building_resilient_prompts_using_an_evaluation_flywheel) | 自定义 eval、版本化数据、同一 eval 比较候选、失败样本回流                                 | 先写 grader 与阴性样本，再比较 baseline/current；失败进入开发集而非修改 holdout                | model grader 只用于主观维度；可由环境裁决的结果不得交给 LLM 猜 |
| [WebRL](https://arxiv.org/abs/2411.02337)                                                                                                                                                 | 从失败 attempt 生成课程，以 outcome-supervised 信号推动迭代                               | Outer Loop 从失败簇产生候选 Skill/策略，在开发集重跑后再过冻结集                               | 本轮不做在线训练；没有可靠 evaluator 时禁止自动回流            |

## 三层评测架构

### L1：Outcome / Safety — 先证明“做对了”

**评测对象：** 环境终态、最终 assistant output、artifact、任务绑定、安全副作用。

**必备 oracle：**

- URL、title、DOM/正文、tab ID、媒体/下载/表单状态等页面事实。
- 最终答案和 artifact 的 schema、字段、来源、行数及可打开性。
- 每个 Mission Gate 的独立 evidence ref；最终 terminal status 是 Gate 聚合结果。
- `false_complete`、`wrong_tab`、任务外副作用、敏感输入处理和 stop/pause 响应。

**裁决规则：**

- 能程序化验证的维度使用 deterministic grader；LLM grader 不能覆盖它的 FAIL。
- evaluator 缺 selector、row、trace 或证据时返回 `invalid_run`，永不由退出码 0 推断 PASS。
- user prompt、Mission、计划文案和模型思维不可成为答案证据。
- binary completion 是发布门；Gate 向量只用于定位，不得以 partial score 抵消 `false_complete`。

### L2：Interaction / Human Alignment — 再证明“像真实协作”

**场景族：**

- 目标有歧义：应问最少且关键的澄清问题。
- 信息缺失或超出知识边界：应进入 waiting_user，而不是编造。
- 用户中途更正、暂停、恢复、追问或停止：保持 Mission 与已验证成果，更新方向事件。
- 请求不可行或越界：解释原因、保留用户控制，不假完成。
- 用户简短、口语、反复、信息分批给出：不把“合作型标准答案用户”当唯一用户。

**模拟器合格门：**

1. persona 来自去标识化真实行为维度：信息密度、回复长度、纠正概率、耐心、领域熟悉度、知识边界；不用人格标签制造极端角色。
2. 模拟器看不到任务隐藏答案、grader、预期 action 或 holdout 标注。
3. 在独立真人对话样本上同时测：消息行为相似度、任务路径分布、assistant 排名一致性。
4. 校准集规模、采样、排除条件和置信区间必须登记；若排名一致性不稳定或区间跨过无相关，simulator 仅可做探索性 stress test。
5. 模拟器模型/提示/persona 任一版本变化，都重新校准；不得沿用旧“已对齐”标签。

**交互指标：**

- 任务成功与政策遵循。
- 必要澄清召回率、无谓澄清率、用户纠正后的恢复率。
- stop/pause 执行延迟，重复请求率，用户需要重述目标的次数。
- 真人与 simulator 对候选版本的 pairwise ranking agreement，附置信区间。

### L3：Long-horizon Reliability — 最后证明“越长仍然稳定”

**任务设计：**

- 从单页读取、单次导航，逐级到多页面、多站点、多 Gate、有中断恢复和动态信息的真实工作流。
- 难度用经盲测的人类完成工时、跨源数量、Gate 数和状态依赖描述；tool-call 数只是诊断字段。
- 长任务必须包含可恢复 checkpoint；重载/中断后从持久计划继续，不从零猜测。

**核心指标：**

- `TSR`：独立 attempt 的 verified success rate。
- `Pass@k`：k 次里至少一次成功，回答“能不能做到”；不能替代可靠性。
- `Pass^k`：同一任务 k 次全部成功的任务占比，回答“能否连续做到”。若每次独立且成功率恒为 `p`，理论值为 `p^k`；正式报告使用实际重复结果，不强行假设独立。
- `50% time horizon`：按真人完成工时 bucket 拟合任务成功率，估计成功率落到 50% 的工时边界；同时报告样本量和不确定区间。
- 恢复率：pause/reload/interrupted 后保持 Mission、Gate 和证据并最终完成的比例。
- 诊断指标：Gate completion vector、latency、步骤数、成本、重试/换路和 failure class。

## 版本化与可复现契约

每个 attempt 必须产生不可变 run manifest；至少包含：

```text
campaign_stamp,eval_spec_version,task_set_version,task_id,attempt,seed,
date,git_sha,dirty_state,extension_version,model,provider_config_hash,
prompt_version,policy_tag,feature_flags,evaluator_version,
attach_mode,browser_version,profile_or_fixture_id,start_url,bound_tab_id,
simulator_model,simulator_prompt_version,persona_id,persona_version,
outcome,false_complete,wrong_tab,side_effect_verdict,failure_class,
latency_ms,cost,trace_path,trace_hash,evidence_path,evidence_hash
```

附加约束：

- 正式分仍使用 `MiniMax-M3`；其他模型只标记为 debug/judge，不混入正式统计。
- `attach_mode` 来自真实启动路径，记录枚举为 `user_chrome`、`connected_cdp`、`launched_chrome_for_testing`、`unit`、`unknown`。`unknown` 不能进入正式分；不启动真浏览器的 `unit` 只能裁决其所属的离线任务。
- campaign/arm/run identity 按 020 确定派生：arm 由冻结配置 tuple 重算，run 由 campaign + task_id + attempt 重算；必须在 runner、trace、manifest、CSV 和 summary 间一致，重复唯一键或单 campaign 混 arm 立即失败。
- task 句、grader、environment snapshot、simulator 和 evaluator 均有独立版本，任何一项变化都形成新 eval spec。
- trace/evidence 需脱敏、可读取且与 manifest hash 一致；路径为空即 invalid。

## 数据分层与冻结 Holdout

| 分区                    | 用途                                | 可否被 Outer Loop 读取 |            可否根据结果改 prompt/Skill |
| ----------------------- | ----------------------------------- | ---------------------: | -------------------------------------: |
| train / failure bank    | 复现生产失败、生成候选策略          |                     是 |                                     是 |
| dev / regression        | 快速回归、消融、persona stress      |                     是 |                     是，但须生成新版本 |
| frozen holdout          | 发布决策、检测过拟合                |                     否 |                                     否 |
| owner native acceptance | 真实 Chrome/登录态/原生侧栏最终判断 |                     否 | 失败只能回到 failure bank 后开启下一轮 |

治理规则：

1. holdout task 句、隐藏状态和 grader 不进入 Agent prompt、simulator prompt、Skill 生成或错误修复上下文。
2. 若 holdout 泄漏、被手工针对或环境不可复现，整批标记 `invalid_run`，换新版本而非删掉失败行。
3. baseline/current 使用同一 task、seed/persona、浏览器版本、attach mode 和环境快照；顺序随机化或交错运行以减小时间漂移。
4. 小于噪声带宽的差异不做切换结论；报告每 task attempt、置信区间和失败簇，而不只报总平均。

## 执行阶梯

### Gate A — Evaluator 自证

- prompt-only answer leakage、缺 row、重复 row、跨 task selector、错误 tab、空 evidence、伪 attach mode 全部有阴性测试。
- 任何 grader error 均 fail-closed；在该 Gate 通过前，历史 `verified_pass` 只可作线索，不能作发布证据。

### Gate B — 可控环境回归

- 运行 020 的 fixture/public/long-horizon 核心集，正式模型 MiniMax-M3。
- 每任务至少 3 个独立 attempt；报告 TSR、`Pass^3`、false_complete、wrong_tab 和 failure class。
- baseline/current 共用冻结环境，并保留完整 run manifest、trace、evidence。

### Gate C — Human-like 多轮压力测试

- 场景覆盖 ambiguity、knowledge boundary、waiting_user、correction、pause/resume、stop、infeasible request。
- 每个候选版本在相同 persona×seed 矩阵上运行；simulator 不得见隐藏答案。
- 只有通过真人校准的 simulator 结果能进入版本比较；其余结果清楚标记 exploratory。

### Gate D — 原生产品验收

- 主 Chrome、已安装扩展、原生 Side Panel，使用真实可观察页面结果。
- 覆盖简单→中等→多站长程，以及 reload/中断恢复。
- 自动 runner 的 PASS 不能覆盖 native FAIL；Owner dogfood 保持最终产品判断权。

### Gate E — 长期可靠性与发布判断

- 对不同真人工时 bucket 运行重复任务，计算 `Pass^k` 和 50% time horizon。
- 新版本只有在 L1 无安全/真实性回退、L2 不降低人类校准交互质量、L3 改善超过噪声后才能晋升。
- 任何 `false_complete=1` 直接拒绝晋升。

## Failure Outer Loop

```text
production/native/dev failure
  -> 脱敏并归入 failure bank
  -> 按 failure_class + Gate + 页面机制聚类
  -> 写一个可证伪根因假设
  -> 做最小修复或候选 Skill
  -> evaluator 阴性测试
  -> dev regression + 消融
  -> frozen holdout
  -> owner native acceptance
  -> 晋升或回滚；新失败进入下一轮
```

硬约束：

- 不从单条失败直接发明通用抽象；同机制失败簇成立后才产生 reusable Skill。
- Outer Loop 不读取 holdout，不自动写生产配置，不自动晋升候选。
- WebRL 的“从失败生成课程”只采用为离线失败回放方法；本轮不做模型训练。
- 每个候选绑定来源失败、假设、变更、dev delta、holdout delta 和残余风险。

## 最小首批任务矩阵

| 任务族       | 样例                               | L1 oracle                             | L2 行为                        | L3 重复                  |
| ------------ | ---------------------------------- | ------------------------------------- | ------------------------------ | ------------------------ |
| 简单读取     | 当前页主题+一个正文细节            | 最终答案字段与正文 evidence           | 不需要多问                     | n=3                      |
| 单次导航     | example.com → IANA，并报告最终 URL | bound tab URL/title + final output    | 找不到时解释/换路              | n=3                      |
| 多页交付     | IANA + Wikipedia 两条观察和双 URL  | 每页独立 Gate + 最终 artifact         | 缺信息时诚实等待               | n=3，报告 Pass^3         |
| 模糊目标     | “整理这页，按我的习惯来”           | 无越权修改                            | 必要澄清；知识边界             | persona×seed 矩阵        |
| 中途纠正     | 运行中改变范围                     | 旧成果保留，新 Gate 生效              | 一次确认或直接按任务内授权调整 | persona×seed 矩阵        |
| 恢复         | pause/reload/interrupted 后继续    | 同 task/Mission/Gate/evidence         | 控制唯一、状态清楚             | 各状态 n=3               |
| 小时级工作流 | 多站研究→结构化报告→回读           | binary final + Gate vector + artifact | 中途信息、stop、追问           | 人类工时 bucket + Pass^k |

## 发布看板

正式 summary 至少同时展示：

| 维度     | 指标                            | 发布条件                                        |
| -------- | ------------------------------- | ----------------------------------------------- |
| 真实性   | false_complete                  | 必须为 0                                        |
| 页面绑定 | wrong_tab                       | 必须为 0                                        |
| 任务成功 | TSR + 置信区间                  | 不低于冻结 baseline，或差异落在预先声明容忍带内 |
| 一致性   | Pass^k                          | 关键任务达到预先登记门槛；不得用 Pass@k 替代    |
| 交互     | 澄清/纠正/stop + 真人排名一致性 | 无显著回退，simulator 校准仍有效                |
| 长程     | 恢复率 + 50% time horizon       | 不回退；提升超过噪声后才宣称能力增强            |
| 可追溯   | manifest/trace/evidence 完整率  | 100%；缺失 run 记 invalid                       |
| 原生验收 | Owner native Side Panel         | PASS；自动分不能覆盖 FAIL                       |

## 当前实施顺序

1. 先修 evaluator 泄漏、attempt、fallback 和 provenance；在此之前不追加“更聪明”的 simulator。
2. 把本轮 native false-complete 任务固化为阴性/冻结回归，并使 Gate 与最终输出可程序化验证。
3. 建立版本化 manifest、baseline/current 同环境比较和 `Pass^3` 汇总。
4. 引入小规模、真人校准的 persona stress 层，优先测 waiting_user、纠正、暂停/恢复/停止。
5. 扩展人类工时标定的长程任务，最后才接 Failure Outer Loop 候选晋升。

**长期发布体系完成定义（非本轮完成声明）：** 三层 Gate 均可运行、证据可回放、冻结 holdout 未泄漏、native acceptance 通过，且后续变更只能在 `false_complete=0` 的前提下以相同版本化协议证明“没有变差或确实更好”。
