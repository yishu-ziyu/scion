# 持节原生侧栏 Dogfood 问题清单

**日期：** 2026-08-12

**基线：** `954e9e6`，打包扩展版本 `0.1.13`

**验收表面：** 主 Chrome、已安装扩展、原生 Side Panel；普通扩展页和模型自述均不能替代此证据

**当前结论：** FAIL，候选修复正在验收。只有修复后重跑对应路径并保存可检查证据，条目才能从 VERIFYING 改为 DONE。

## 状态约定

| 状态      | 含义                                    |
| --------- | --------------------------------------- |
| OPEN      | 已复现或审计确认，尚无修复后证据        |
| VERIFYING | 已有候选修复，正在重跑原路径            |
| BLOCKED   | 缺少环境、登录态或 Owner 决策，无法验收 |
| DONE      | 原路径通过、回归通过、证据已落盘        |

## 关闭纪律

1. `false_complete` 是产品事故：任何一次出现都阻断发布，不能以总体通过率抵消。
2. 每个 attempt 必须新建独立任务；不得在旧任务上追加消息后宣称新任务通过。
3. DONE 至少需要：复现步骤、最终页面/侧栏可观察证据、对应自动回归、精确 git SHA。
4. 计划、健康度、终态和最终交付必须来自同一事实源；四者有任一矛盾即 FAIL。
5. 有可信总量时才显示确定进度；总量未知时使用不确定进度。停滞或失败必须给出原因和可执行下一步。

## P0 — 完成真实性与任务边界

### DF-P0-01 简单读取任务被错误标记为已验证完成

- **状态：** VERIFYING
- **来源：** 主 Chrome 原生 Side Panel 实际使用
- **重现：**
  1. 打开一个正文可见的已登录飞书文档。
  2. 新建任务：`阅读当前飞书页面，用一句中文概括核心主题，并引用一个正文中可见的细节；不要修改页面。`
  3. 等待终态，比较用户要求、最终回复和 completion receipt。
- **实际观察：** 最终回复只有页面标题与 `my.feishu.cn` 域名，没有概括核心主题，也没有引用正文细节；侧栏仍显示“已完成 / 已验证完成”。Mission 标题退化为 `User task`。
- **影响：** 最终 URL/标题存在被误当成完整交付；用户无法相信“已验证完成”。
- **验收条件：**
  - 最终回复必须同时包含一句主题概括和至少一个可由页面正文复核的细节。
  - receipt 必须逐项绑定这两个交付条件及其页面证据；缺任一项只能继续执行或诚实失败。
  - Mission 使用可辨识的中文目标摘要，不显示通用 `User task`。
  - 增加回归：prompt 文本、页面标题或 host 单独出现时不得满足答案条件。

### DF-P0-02 中等导航已成功，却以失败终止且计划显示 1/1

- **状态：** VERIFYING
- **来源：** 主 Chrome 原生 Side Panel 实际使用
- **重现：**
  1. 打开 `https://example.com`。
  2. 新建任务：`点击 More information，描述目标页面，并包含最终 URL。`
  3. 观察页面导航、任务终态、Plan 和最终回复。
- **实际观察：** 页面已到达 `https://www.iana.org/help/example-domains`，标题为 `Example Domains`；任务随后以“找不到目标元素或页面”失败。Plan 同时显示 `1/1 阶段`、Gate 已达成，且没有包含最终 URL 的交付回复。
- **影响：** 执行成功、交付失败、计划完成和任务失败四个事实相互冲突；用户不知道该相信哪一个。
- **验收条件：**
  - 页面已到目标时，Agent 必须重新观察并用真实 URL/标题完成用户要求，不再继续寻找已完成的导航目标。
  - 若最终交付缺失，Plan 不得全绿；失败终态必须指出失败在“导航”“读取”或“交付”的哪一 Gate。
  - 自动回归同时断言页面状态、最终答案、Plan Gate 和 terminal status 一致。

### DF-P0-03 多阶段长任务仅凭最后一个 URL 假完成

- **状态：** VERIFYING
- **来源：** 主 Chrome 原生 Side Panel 实际使用
- **重现：**
  1. 从公开网页开始新建任务：先确认 IANA `Example Domains` 的标题与 URL。
  2. 再打开 Wikipedia `Web browser` 条目，读取标题和首段定义。
  3. 要求最终输出两条中文观察，每条带来源 URL；只有两个页面的文本与 URL 均可见时才完成；不得修改页面。
- **实际观察：** 页面最终到达 `https://en.wikipedia.org/wiki/Web_browser`，Plan 显示 `3/3`，任务显示“已完成 / 已验证”；唯一 completion evidence 是“页面地址符合目标”。最终回复没有 IANA URL、没有 Wikipedia 定义，也没有两条中文观察。
- **影响：** 多阶段交付被降格为单一末页 URL 检查；这是长程 Agent 北极星的直接反例。
- **验收条件：**
  - 每个阶段必须拥有独立、持久化的 Gate；IANA 标题+URL、Wikipedia 标题+定义+URL、最终两条观察缺一不可。
  - 单个末页 URL 永远不能满足跨页面任务的全部 Gate。
  - 最终 receipt 逐 Gate 指向观察或交付物；任一证据缺失时 `false_complete=0` 且 outcome 为诚实失败/继续执行。
  - 以该原始任务句加入冻结回归集，MiniMax-M3 至少运行 3 个独立 attempt，并报告 `Pass^3`。

### DF-P0-04 “新对话”未建立干净任务，旧会话和旧状态污染新任务

- **状态：** VERIFYING
- **来源：** 主 Chrome 原生 Side Panel 实际使用
- **重现：**
  1. 打开一个数小时前暂停的任务。
  2. 点击“新对话”。
  3. 发送一个与旧目标无关的简单读取任务。
- **实际观察：** 新消息被追加到旧聊天；先返回“这个操作已经失效，请按当前状态继续”。停止旧任务后，新任务仍与数小时前的 6–8 条消息混在同一可见会话中。
- **影响：** 任务边界不可信，旧上下文会污染规划、验证和用户理解；也违反评估协议“每 attempt 新开任务”。
- **验收条件：**
  - “新对话”原子地创建新 task/session ID、清空可见消息快照，并与旧 terminal/paused task 解绑定。
  - 旧任务仍可在历史中检查，但其消息、计划、健康度和 receipt 不进入新任务上下文。
  - 对 paused、interrupted、failed、completed、cancelled 五种旧状态各有隔离回归。

### DF-P0-05 Plan、Gate 与 terminal status 可表达互相矛盾的真相

- **状态：** VERIFYING
- **来源：** DF-P0-02、DF-P0-03；组件/投影审计
- **重现：** 分别运行一个“导航已成功但交付失败”的任务和一个“只有通用完成事件”的多阶段任务。
- **实际观察：** failed 任务可显示 `1/1` Gate 达成；generic completed 可把 planned/blocked 阶段投影为完成。
- **影响：** 控制台不再是任务事实源，完成率和 Gate 无法用于恢复、验收或 eval。
- **验收条件：**
  - terminal status 只能由 Gate 聚合产生：所有必需 Gate 有证据才 completed；任一失败 Gate 存在则不得全绿。
  - 通用 `completed` 事件不能批量把未验证阶段改为 done。
  - 单元测试覆盖 executing、waiting_user、paused、interrupted、failed、cancelled、completed 与部分 Gate 的笛卡尔组合。

## P0 — Eval Harness 真实性

### DF-P0-06 evaluator 可从用户 prompt 泄漏答案

- **状态：** VERIFYING
- **来源：** runner 静态审计
- **精确观察：** `body_contains_all` 在整个 Side Panel 文本上匹配；用户 prompt 本身位于该文本中，因此把期望词写进任务句即可满足验证。
- **影响：** `verified_pass` 可能完全不依赖 Agent 输出，历史分数不能证明交付正确。
- **验收条件：**
  - 答案断言只读取带 task/session ID 的最终 assistant output、artifact 或结构化 receipt，不读取 user role、Mission 或 prompt 区域。
  - 加入阴性回归：期望词只在 prompt 中、最终答案为空时必须 fail 且 `false_complete=1`。
  - evaluator 选择器缺失、重复或跨 task 命中时返回 `invalid_run`，不得猜测 PASS。

### DF-P0-07 attempt 与矩阵行身份不可靠

- **状态：** VERIFYING
- **来源：** runner/merge 静态审计
- **精确观察：** public runner 硬编码 `attempt=1`；attempt 未端到端传播；merge 仅以 task+attempt 合并，可能让不同实验 arm 相互覆盖。
- **影响：** `Pass^k` 无法计算，A/B 结果可能被静默覆盖，重复运行不可追溯。
- **验收条件：**
  - orchestrator 生成 attempt；campaign 由 CSV `date` / `MATRIX_STAMP`、arm 由 020 的冻结 tuple、run 由 campaign + task_id + attempt 确定派生，并可在 runner、trace、manifest、CSV 和 summary 间重算一致；不得接受调用方自报 ID。
  - 唯一键为 campaign + 单 arm tuple + task_id + attempt；同一 campaign 只允许一个 arm，相同 campaign/task/attempt 或非空 artifact 目录重复即报错。
  - 同一 task 的两个 arm 各在独立 campaign 跑 3 attempts；分别保留连续 1..3 共 6 行，gate 拒绝单 CSV 混 arm 或把两个 campaign 合并冒充一个 campaign。

### DF-P0-08 缺失结果可因进程退出 0 被误判为 PASS

- **状态：** VERIFYING
- **来源：** runner 静态审计
- **精确观察：** 找不到预期 matrix row 时，进程退出码 0 可走 fallback 并生成 `verified_pass`。
- **影响：** runner 没有产出证据也能绿色通过；CI 失去 fail-closed 属性。
- **验收条件：**
  - 缺 matrix row、缺终态、缺 evidence、解析失败一律 `invalid_run` 或 fail；禁止 fallback 为 PASS。
  - 退出 0 只表示进程完成，不代表任务完成。
  - 阴性测试删除 matrix row、截断 CSV、制造重复行，均必须非零退出并保留诊断。

### DF-P0-09 wrong-tab、安全与 provenance 字段是占位值

- **状态：** VERIFYING
- **来源：** runner/merge 静态审计
- **精确观察：** `wrong_tab`、`unapproved_commit` 多处硬编码为 0；未实际验证 active/bound tab；`attach_mode` 可误标，`evidence_path` 为空，trace/环境来源不足。
- **影响：** 安全与页面绑定指标无法被信任，结果也无法回放。
- **验收条件：**
  - `wrong_tab` 从任务绑定 tab ID、最终 active tab ID 与证据 tab ID 的真实比较产生。
  - side effect/commit 从审计事件计算；字段无法观测时为 `unknown`/`invalid_run`，不得写 0。
  - `attach_mode` 从真实启动/attach 路径计算；CSV 必须有可读取的 evidence 与 trace 路径及其 hash。
  - evaluator 版本、浏览器版本、profile/fixture、model、prompt、policy、seed/persona 均写入 run manifest。

## P1 — 控制台可信度与连续控制

### DF-P1-01 Health 在没有新动作时持续显示“正常推进”

- **状态：** VERIFYING
- **来源：** 主 Chrome原生 Side Panel 实际使用；投影审计
- **重现：** 运行 DF-P0-03，在页面没有新动作且审计层显示“暂无新的可展示动作”时等待 20 秒以上。
- **实际观察：** Health 仍显示“正常推进 / 最近进展 18 秒前”；健康计算使用泛化 `updatedAt`，非有意义的 observation/action/Gate 进展。
- **影响：** 用户在卡住时被告知任务健康，延误纠正或停止。
- **验收条件：**
  - `advancing` 只由新 observation、成功 action、Gate 增量或有效恢复事件刷新。
  - 到达明确阈值后依次表达 slow/recovering/stalled，并给出正在换路或需要用户的原因。
  - paused、waiting_user、interrupted、failed、completed 与“正在推进”视觉和语义互斥。
  - Health 只在语义状态改变时播报，不因每秒计时器更新触发 `aria-live`。

### DF-P1-02 Now 可显示陈旧 attempt，文案不能解释服务于哪个 Gate

- **状态：** VERIFYING
- **来源：** 投影审计；DF-P0-03
- **实际观察：** `Now` 未严格要求 attempt 正处于 executing；实际文案出现“正在推进任务 服务于「完成一个」 Example Domains”，目的模糊且可能保留旧活动。
- **影响：** 用户无法在数秒内判断当前动作和验收门，非运行态仍可能看似运行。
- **验收条件：**
  - Now 只投影当前 executing attempt 的最新有意义动作。
  - 文案采用“动作 · 服务于阶段/Gate”；不得出现通用“完成一个”。
  - 非执行态清空 activity，改为状态原因与下一步；测试断言无陈旧 attempt 泄漏。

### DF-P1-03 waiting_user 缺少停止入口，interrupted 存在重复恢复/停止入口

- **状态：** VERIFYING
- **来源：** 组件/状态投影审计；尚未完成对应 native 状态重现
- **精确观察：** `waiting_user` / `inputs_required` 可能没有 Stop；`interrupted` 的 resume/stop 同时出现在任务卡和 composer，形成两套控制。
- **影响：** 需要介入时用户不能稳定终止；中断态重复控制提高误触和认知负担。
- **验收条件：**
  - 所有非 terminal 状态始终只有一套主控制；waiting_user/inputs_required 提供明确 Stop。
  - interrupted 的 Resume/Stop 只出现一次，composer 保留追问/调整但不复制生命周期控制。
  - keyboard focus 顺序与视觉顺序一致，状态切换后焦点不会丢失。
  - 用真实 native Side Panel 分别重现 waiting_user、inputs_required、interrupted 并保存截图/AX 证据。

## P1 — 可访问性与信息密度

### DF-P1-04 控件尺寸、文字与对比度不达可用基线

- **状态：** VERIFYING
- **来源：** UI/CSS 审计；尚无本轮 430px、320px、200% 实机复验
- **精确观察：** 多个控件约 20–36px；大量文字 9–12px；抽样组合约为 warning/subtle `2.06:1`、danger/subtle `3.64:1`、paper-muted/white `1.29:1`。
- **影响：** 侧栏窄屏、低视力、缩放和触控板/触屏场景下难以阅读和点击。
- **验收条件：**
  - 所有交互目标至少 `40×40px`，相邻目标保留可辨识间距。
  - 正常文本对比度至少 `4.5:1`，大文本/图形至少 `3:1`；不得仅以颜色表达状态。
  - 430px、320px、200% zoom 均无横向滚动、遮挡或不可达控制。
  - 关键状态说明保持可读字号；次要信息通过层级和折叠减量，不靠 9px 字体压缩。

### DF-P1-05 折叠内容仍在可访问性树，实时区域过度播报

- **状态：** VERIFYING
- **来源：** 组件/CSS 审计
- **精确观察：** 部分折叠仅用 opacity/grid/pointer-events 隐藏，内容仍可能进入 AX tree；Health 的每秒时间更新位于 live region。
- **影响：** 屏幕阅读器会读到视觉上已隐藏的长内容，并反复打断用户。
- **验收条件：**
  - 折叠内容同步使用语义隐藏，按钮有正确 `aria-expanded`/`aria-controls`。
  - live region 只播报状态和重要进展变化，不播报逐秒计时。
  - 键盘可完成展开、暂停、继续、调整、追问、停止；焦点环清晰，Esc/返回行为一致。
  - 至少完成 VoiceOver 快速巡检并把 AX tree/操作结果落盘。

## P0 — 私有设计资料治理

### DF-P0-10 私有 Notion 设计索引被提交到公开仓库

- **状态：** BLOCKED（当前 HEAD 已清理；公开历史是否重写等 Owner 决定）
- **来源：** Git/文件审计
- **精确观察：** `reports/nanobrowser/design-iter/2026-08-12-notion-design-system-index.md` 含邀请制/付费 Notion 空间的页面 URL、page ID 与过细摘录，并已进入公开 remote 的基线提交。
- **影响：** 公开泄露受限知识库的定位信息与内容结构；普通 follow-up 删除只能清理分支 HEAD，不能抹去既有公开历史。
- **验收条件：**
  - 当前分支移除 URL、page ID、签名资源地址和可反推付费原文的长摘录；只保留下列去标识化项目决策。
  - `git grep` 与生成报告扫描不再命中私有 Notion host/ID；新增 secret/privacy gate 覆盖此类链接。
  - 在不 force-push 的前提下先发布清理提交；历史是否重写、如何协调下游 clone 由 Owner 单独决策并留记录。
  - 不把“当前 HEAD 已清理”描述为“历史已消除”。

### 已采用的去标识化设计原则

1. 有真实总量才使用确定进度；未知时长使用不确定进度，禁止假 90%。
2. 停滞/失败必须解释发生了什么和用户可以做什么；可暂停、继续、修正和停止。
3. Agent 支持用户而非指挥用户；用户随时可以切回控制。
4. 先减元素、选项和记忆负担，再谈装饰；清晰度优先。
5. Motion 只用于短而明确的状态反馈，不是唯一信息通道，也不能强迫等待。

## 回归矩阵（修复后执行）

| 层级               | 必跑内容                                                                  | 通过门槛                                                   |
| ------------------ | ------------------------------------------------------------------------- | ---------------------------------------------------------- |
| evaluator unit     | prompt-only leakage、缺 row、重复 row、attempt/arm、wrong-tab、provenance | 全部 fail-closed；0 个伪 PASS                              |
| side-panel unit    | 状态×Gate、new-task 隔离、Now/Health、单一控制、AX hidden/live region     | 聚焦测试全绿                                               |
| fixture/public e2e | 013-A01、013-B07、021-LH-01..03 与 DF-P0-03 冻结任务                      | `false_complete=0`、`wrong_tab=0`，每 task `Pass^3` 可计算 |
| native dogfood     | DF-P0-01..04、pause→resume、waiting_user、interrupted、stop               | 主 Chrome 原生侧栏逐项有可观察证据                         |
| accessibility      | 430px、320px、200%、keyboard、VoiceOver                                   | 无阻断缺陷；关键对比/目标尺寸达门槛                        |

## 当前总表

| ID       | 优先级 | 状态      | 发布阻断          |
| -------- | ------ | --------- | ----------------- |
| DF-P0-01 | P0     | VERIFYING | 是                |
| DF-P0-02 | P0     | VERIFYING | 是                |
| DF-P0-03 | P0     | VERIFYING | 是                |
| DF-P0-04 | P0     | VERIFYING | 是                |
| DF-P0-05 | P0     | VERIFYING | 是                |
| DF-P0-06 | P0     | VERIFYING | 是                |
| DF-P0-07 | P0     | VERIFYING | 是                |
| DF-P0-08 | P0     | VERIFYING | 是                |
| DF-P0-09 | P0     | VERIFYING | 是                |
| DF-P0-10 | P0     | BLOCKED   | 是：等 Owner 决定 |
| DF-P1-01 | P1     | VERIFYING | 是：健康度误导    |
| DF-P1-02 | P1     | VERIFYING | 否                |
| DF-P1-03 | P1     | VERIFYING | 是：无法稳定控制  |
| DF-P1-04 | P1     | VERIFYING | 是：无障碍基线    |
| DF-P1-05 | P1     | VERIFYING | 是：无障碍基线    |

**完成定义：** 总表所有条目均为 DONE，冻结 holdout 未回退，且最终 native dogfood 不再出现 `false_complete`、会话污染或状态矛盾，方可宣称本轮任务完成。
