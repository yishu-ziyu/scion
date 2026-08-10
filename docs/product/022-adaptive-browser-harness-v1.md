---
title: "Adaptive Browser Harness v1"
description: "将持节执行核升级为 Browser Kernel + Skill Runtime + Observation Diff + Independent Verifier；网站知识迁出 Core，成功判断迁出 Executor。"
category: "product"
number: "022"
status: proposed
services: ["docs", "projects/chijie-browser"]
related:
  - "product/019"
  - "product/020"
  - "product/021"
  - "decisions/001"
  - "decisions/002"
  - "design/002"
  - "design/007"
last_modified: "2026-08-11"
---

# 022 · Adaptive Browser Harness v1

**Owner：yishu-ziyu**
**产品：持节 / Chijie**
**依赖：019 / 020 / 021**
**落地 commit：`139a0a2`（2026-08-10）**

## 0. 状态（禁止混为一谈）

本文件区分两个概念，**不得**用其中一个冒充另一个：

| 概念 | 本文件取值 | 含义 |
| --- | --- | --- |
| **product_status** | `proposed` | 整包 022 尚未通过 §19 Release Gate 全表；**不是**“代码不存在” |
| **implementation_status** | 见下表 | 代码与默认 feature flags 的真实程度 |

### 0.1 Feature flags（`DEFAULT_EVAL_SETTINGS`）

来源：`projects/chijie-browser/packages/storage/lib/settings/evalSettings.ts`
消费主路径：`control-llm.ts`（Kernel / Diff / Skill）、`task/manager.ts`（Artifact Verifier）。

| Flag | Default | 默认生产路径？ | implementation_status | 证据 |
| --- | --- | --- | --- | --- |
| `enableBrowserKernelV1` | **true** | **是**（`!== false` → `kernel.observe()`） | **default_enabled** | `control-llm.ts` observeFrame；单测 `browser-kernel.test.ts` |
| `enableSkillRuntime` | **true** | **是**（decide 前 `skillRuntime.tryDecide`） | **default_enabled** | 5 builtin + 2 site skills；`runtime.test.ts` |
| `enableArtifactVerification` | **true** | **是**（有 artifact 时 `verifyArtifactsIndependently`） | **default_enabled** | `verification-engine.ts` + manager；注：flag 字段存在，但 manager **未读 flag 做 opt-out**，行为等同常开 |
| `enableObservationDiff` | **false** | **否**（仅 `=== true` 才把 diff 喂给模型） | **landed + experimental** | Diff 计算已实现；默认关；**不是** continuous shadow（关时不算 diff）；**未**证明 payload -30% |
| `enableLearnedSkills` | **false** | **否** | **partial** | `skills/learned/plan.ts` 可 validate/run；**未**挂入 `createDefaultSkillRegistry` / discover；无晋升证据 |

### 0.2 四层能力 realization

| 能力 | implementation_status | 说明 |
| --- | --- | --- |
| Browser Kernel | **default_enabled** | 默认 control 路径经 Kernel observe/act 接口 |
| Skill Runtime（builtin/site） | **default_enabled** | 默认先 Skill 再 LLM；网站特判迁出 control-llm 目标由 core-purity 测约束 |
| Observation Diff | **landed / experimental** | 代码完整；默认关闭；Release Gate「payload 中位数 ≥30%」**NOT_RUN** |
| Independent Verifier（Artifact） | **default_enabled** | Executor 只出 `candidate_complete`；有 artifact 时独立校验 |
| Learned Skills 晋升 | **partial** | 计划 runner 有；运行时接入与 promotion evidence 无 |

### 0.3 Release Gate 矩阵（§19；2026-08-11 审计）

| Gate | 状态 | 说明 |
| --- | --- | --- |
| Regression vs Phase 0 baseline | **NOT_RUN** | 无固定 Phase 0 TSR 对照报告绑定 022 |
| False Complete = 0 | **PARTIAL** | 单元 + 长程 formal batch 有 `false_complete=0` 证据；非 022 专用 release run |
| Wrong Tab = 0 | **PARTIAL** | 既有 wrong-tab 约束仍在；无 022 专用矩阵 |
| Core purity | **PASS** | `control-llm-core-purity.test.ts`：禁止 `browser/sites/*` import |
| Side effects via dispatchAction | **PARTIAL** | Skill Runtime 设计经 Kernel/hooks；缺全量侧效审计报告 |
| Observation Diff ≥30% | **NOT_RUN** | flag 默认 false；无中位数证据 |
| Skill fallback | **PARTIAL** | 单测覆盖失败回退；缺真机长任务统计 |
| Verification independent | **PARTIAL** | Verifier 代码 + manager 接线；缺 022-VERIFY/ARTIFACT 正式矩阵 |
| Trace Skill/Diff/Artifact/Verify | **PARTIAL** | trace span 种类已扩；缺统一 release 回放验收 |
| Privacy | **PARTIAL** | 沿用既有 privacy 审计；非 022 重跑 |

**结论：** product_status 保持 **proposed**（整包未 ship）。
**同时必须承认：** Kernel / Skill Runtime / Artifact Verifier 已在 **main 默认开启**。
禁止再写「022 未开工 / 不得走默认路径」——那与 `DEFAULT_EVAL_SETTINGS` 和 `control-llm` 冲突。

### 0.4 `139a0a2` 测试含义

Commit 声称：52 files / **421** cases 全绿；type-check 12 packages 通过。

| 能证明 | 不能单独证明 |
| --- | --- |
| 结构落地、单元契约、core purity 静态约束 | 默认开启后的真机 TSR 不回归 |
| Verifier / Kernel / Skill 的局部正确性 | Release Gate 全表 |
| Feature flag 接线存在 | ObservationDiff/LearnedSkills 已生产可用 |

---

## 1. 目标

将持节当前浏览器 Agent 执行核升级为四层结构：

```text
Mission / Plan
      │
      ▼
Agent Policy
      │
      ├──────── Skill Runtime
      │
      ▼
Browser Kernel
      │
      ▼
Chrome / CDP
      │
      ▼
Independent Verifier
```

本轮最终希望获得四项能力：

| 能力 | 目标 |
| --- | --- |
| Browser Kernel | Agent 与 Chrome 控制实现解耦 |
| Skill Runtime | 网站/任务经验成为可发现、可调用、可评测的能力 |
| Observation Diff | Agent 主要看到“发生了什么变化”，减少重复整页上下文 |
| Independent Verifier | Executor 无权宣布最终成功，环境证据独立裁决 |

用户体验保持不变：

> 用户给出一个目标 → 持节自己规划 → 浏览网页 → 使用已有能力或通用操作 → 生成成果 → 验证成果 → 返回可检查的完成结果。

**一句话：** 别换 Browser Agent 框架。把现有 Chrome-native TS Agent 继续做成自己的 Harness。底座不用换；真正要砍的是 Core 里的网站特判、整页重传 Observation、以及 Executor 自证完成。

---

## 2. 当前架构判断

以下部分继续保留：

- `Chrome MV3 + TypeScript` 是最终运行形态。
- `BrowserContext` 继续负责实际 Chrome 页面控制。
- `TaskManager / ActionDispatcher / CompletionChecker` 继续作为任务生命周期和副作用控制的权威实现。
- `ExecutorHooks.dispatchAction()` 继续作为所有浏览器副作用的唯一合法入口。
- `observe-act-loop.ts` 继续负责：

```text
Observe
→ Decide
→ Act
→ Re-observe
→ Stop / Retry
```

- `pageRevision`、Snapshot Frame、stale action reject 全部保留。
- `trace.ts`、`eval-matrix`、model swap、feature flags 全部继续复用。

本 PRD **不引入 Stagehand、Browser Use 或 Python sidecar 作为生产依赖**。

选型重申（与 `decisions/001`、`decisions/002` 一致）：

```text
Chrome MV3 Extension
        ↓
TypeScript Agent Harness
        ↓
chrome.debugger / CDP + chrome.tabs + scripting
        ↓
用户真实 Chrome
```

而不是 `Extension → Python Browser Use`，也不是 `Extension → Stagehand → Playwright/Cloud Browser`。

---

## 3. 当前主要问题

### P1. Core 正在吸收网站知识

当前 `control-llm.ts` 同时负责：

```text
Agent policy
Browser observation
Bilibili 特判
YouTube 特判
Wikipedia 特判
表单特判
商品列表特判
理解类快捷路径
上下文组装
模型调用
动作执行
```

继续沿这个方向开发，会让每提高一次成功率，都增加核心执行器复杂度。

目标状态：

```text
control-llm.ts

只知道：

observe
discover skills
decide
act / run skill
verify
```

它不应该知道 Bilibili、YouTube、Amazon、Wikipedia 是什么。

### P2. Skill 目前主要存在于“外环候选”

019 已经定义：

```text
Trajectory
→ Skill candidate
→ Regression
```

并要求高质量轨迹经过换输入重跑后才能晋升。

缺的是运行时：

```text
发现 Skill
→ 选择 Skill
→ 执行 Skill
→ 记录 Skill 表现
→ 失败时回退到通用 Agent
```

### P3. Observation 仍以“当前页面完整状态”为中心

目前 Context v1 已经实现窗口化轨迹和确定性压缩，但主体仍然是最新 Observation + 压缩后的旧轨迹。

浏览器 Agent 很多时候真正需要的信息是：

```text
我刚才做了什么？
页面因此发生了什么变化？
目标有没有更接近？
```

而不是再次阅读几乎相同的页面。

### P4. 完成验证对 Artifact 支持不足

URL、页面文字、媒体、Tab、下载等已有结构化 completion criteria。

但长程任务还包括：

```text
10 家竞品 → 对比表
20 个商品 → CSV
5 个来源 → 研究报告
网页信息 → 邮件草稿
```

这些成果需要成为可验证对象，而不只是 `summary: string`。

---

## 4. Browser Kernel

新增：

```text
chrome-extension/src/background/browser/kernel/
  types.ts
  browser-kernel.ts
  observation.ts
  diff.ts
```

Browser Kernel 是 Agent 与 BrowserContext 之间的稳定接口。

建议接口：

```ts
interface BrowserKernel {
  observe(options?: ObserveOptions): Promise<ObservationFrame>;

  act(
    roundId: string,
    actionName: string,
    args: unknown,
    frameRevision?: string
  ): Promise<KernelActionResult>;

  extract<T>(
    request: ExtractionRequest<T>
  ): Promise<ExtractionResult<T>>;

  waitFor(
    condition: WaitCondition,
    timeoutMs: number
  ): Promise<ObservationFrame>;
}
```

语义对齐（不引入外部依赖，在自有 Kernel 内实现类似能力）：

```ts
browser.observe(goal)
browser.act(action)
browser.extract(schema)
browser.runSkill(skill) // via Skill Runtime, not Kernel itself
```

Kernel **不得重新实现浏览器控制**。

`act()` 内部仍通过：

```text
ActionBuilder
→ ExecutorHooks.dispatchAction()
→ ActionDispatcher
→ BrowserContext
```

所有安全、Trace、Task Round、防 stale、停止能力继续生效。

---

## 5. ObservationFrame

现有字符串 Observation 改成结构化 Frame。

```ts
interface ObservationFrame {
  frameId: string;
  observedAt: number;

  tab: {
    id: number;
    url: string;
    title: string;
  };

  pageRevision: string;

  interactiveElements: InteractiveElementDigest[];

  viewport?: {
    scrollY: number;
    viewportHeight: number;
    documentHeight: number;
  };

  media?: MediaObservation;

  screenshotRef?: string;

  signals: PageSignal[];
}
```

`screenshotRef` 只表示本轮临时视觉状态。

不得因此把完整截图长期写进 Trace。

完整 Observation 目标形态（演进方向，V1 可分阶段落地）：

```text
ObservationFrame
├── DOM / Accessibility Tree
├── 可交互元素
├── Screenshot
├── 页面语义区域
├── 上一步之后发生的 diff
├── Network / navigation events
└── 当前已有 artifacts
```

---

## 6. Observation Diff

每次 Act 前后保留：

```text
Frame N
   │
 Action
   │
Frame N+1
   │
   ▼
ObservationDiff
```

接口：

```ts
interface ObservationDiff {
  fromRevision: string;
  toRevision: string;

  urlChanged: boolean;
  titleChanged: boolean;

  addedElements: ElementDigest[];
  removedElements: ElementDigest[];
  changedElements: ElementChange[];

  scrollDelta?: number;
  mediaChange?: MediaChange;

  materialChange: boolean;
}
```

元素身份优先复用现有：

```text
pageRevision
branch path hash
历史 DOM identity
```

禁止再造第二套 selector identity。

模型上下文策略修改为：

```text
首次观察
→ Full Frame

发生导航 / 页面大幅变化
→ Full Frame

普通动作之后
→ Diff + 当前相关元素

连续无变化
→ no_progress signal
```

目标：

> Agent 的注意力从“整个网页是什么”转向“刚才的行动导致什么变化”。

增加 Trace 指标：

```text
observation_full_chars
observation_rendered_chars
diff_chars
material_change
```

---

## 7. Skill Runtime

新增：

```text
chrome-extension/src/background/agent/skills/
  types.ts
  registry.ts
  runtime.ts
  discovery.ts

  builtin/
    form-fill-submit.ts
    repeating-list-extract.ts
    search-and-open.ts
    media-control.ts

  sites/
    youtube/
    bilibili/
    wikipedia/
```

Skill 是比 Browser Primitive 更高一级的能力。

例如：

```text
primitive:
click
input
navigate
scroll

skill:
填写并提交表单
抓取重复列表
搜索并打开结果
控制当前视频
```

Skill 接口：

```ts
interface BrowserSkill<I, O> {
  manifest: SkillManifest;

  run(
    context: SkillContext,
    input: I
  ): Promise<SkillResult<O>>;
}
```

Manifest：

```ts
interface SkillManifest {
  id: string;
  version: string;

  description: string;

  capabilities: string[];

  domains?: string[];

  requiredPrimitives: string[];

  risk: 'read' | 'reversible' | 'external_commit';

  inputSchema: unknown;
  outputSchema: unknown;
}
```

例如：

```text
id: extract-repeating-list
capabilities:
  - extract_list
  - compare_items

domains:
  - "*"
```

或者：

```text
id: youtube-open-first-video

domains:
  - youtube.com

capabilities:
  - open_first_result
  - video_navigation
```

Skill Runtime 是本 PRD 最值钱的一层：一旦做通，持节不再只是“预先写了 N 个工具”，而会开始变成“Agent 用浏览器，同时学习如何更好地使用这个浏览器”。

---

## 8. Skill 的硬边界

Skill 不允许：

```text
直接 chrome.tabs.*
直接 chrome.debugger.*
直接 BrowserContext.*
绕过 ActionDispatcher
自行修改 Task 状态
自行声明 completed
```

SkillContext 只暴露：

```ts
interface SkillContext {
  kernel: BrowserKernel;
  taskId: string;
  roundId: string;
  signal: AbortSignal;
  trace: SkillTrace;
}
```

因此：

```text
Skill
 ↓
Browser Kernel
 ↓
dispatchAction
 ↓
Chrome
```

所有能力仍经过同一条安全和观测链。

建议加 ESLint/import-boundary test，防止以后有人图省事绕过 Kernel。

---

## 9. Skill Discovery

Agent 不应该每轮看到几十个 Skill 的完整定义。

流程：

```text
Task
 ↓
当前 URL + Intent + Plan phase
 ↓
Skill Registry 预筛
 ↓
Top ≤ 5 candidate skills
 ↓
模型选择
 ↓
run_skill
```

Candidate 至少依据：

```text
domain match
capability match
当前任务阶段
Skill enabled 状态
```

如果没有匹配：

```text
fallback → 普通 observe/act loop
```

Skill 执行失败：

```text
Skill fail
 ↓
记录 failure_class
 ↓
最多一次 Skill 内恢复
 ↓
回退通用 Agent
```

不能因为 Skill 存在，就锁死 Agent。

---

## 10. Builtin Skill 第一批迁移

第一阶段不新增业务能力。

先把当前 Core 中已经存在的确定性代码迁出去。

迁移对象：

| 当前能力 | 新位置 |
| --- | --- |
| Form fill + submit | `builtin/form-fill-submit` |
| Product list → CSV | `builtin/repeating-list-extract` |
| Wikipedia search | `builtin/search-and-open` 或 site adapter |
| YouTube first video | `sites/youtube` |
| Bilibili first video | `sites/bilibili` |
| media play/pause | generic media skill |

完成后：

**`control-llm.ts` 不允许再 import `browser/sites/*`。**

新的站点适配也不得直接加进 `control-llm.ts`。

这是本 PRD 的硬验收项。

---

## 11. Learned Skill

这是 Scion 真正开始“自己积累能力”的地方。

但 V1 不允许运行时生成任意 JavaScript。

Learned Skill 使用声明式 Skill Plan：

```ts
type SkillStep =
  | { op: 'observe' }
  | { op: 'act'; action: string; args: Record<string, SkillExpr> }
  | { op: 'extract'; schema: unknown; saveAs: string }
  | { op: 'wait_for'; condition: WaitCondition }
  | { op: 'assert'; criterion: CompletionCriterionDraft };
```

例如：

```text
Skill: 商品页提取价格和评分

observe
→ extract repeating records
→ assert row_count >= 5
→ return table artifact
```

禁止：

```text
eval()
new Function()
remote JavaScript
任意动态代码执行
```

因此 Outer Loop 可以真正形成：

```text
Verified Trace
      ↓
Candidate SkillPlan
      ↓
静态验证
      ↓
不同输入重跑 ≥ 3
      ↓
通过 Eval
      ↓
保存到 Skill Registry
```

这与 019 的 Skill 晋升纪律直接接上。

演进愿景（V1 之后，不在本轮范围强制交付）：

```text
Agent 执行
   ↓
发现通用工具不够
   ↓
临时生成 helper（声明式 SkillPlan，非任意 JS）
   ↓
完成任务
   ↓
Verifier 验证
   ↓
多次成功
   ↓
提升为持久 Skill
   ↓
以后直接调用
```

---

## 12. Artifact

新增最小成果协议：

```ts
interface TaskArtifact {
  id: string;

  type:
    | 'text'
    | 'table'
    | 'recordset'
    | 'file';

  title: string;

  data: unknown;

  sources: ArtifactSource[];

  createdAt: number;
}
```

例如商品研究：

```text
artifact.type = table

columns:
name
price
rating

rows: 20

sources:
amazon.com/...
amazon.com/...
```

Skill 可以产生 Artifact。

Agent 可以产生 Artifact。

但 Artifact 本身仍然不等于成功。

必须进入 Verifier。

---

## 13. Independent Verifier

现有 CompletionChecker 继续作为核心基础。

新增一层明确的：

```text
VerificationEngine
```

关键原则：

> Executor 只能提出 candidate_complete。

Executor、Skill、LLM 都不能直接把 Task 设成 completed。

流程：

```text
Executor
   ↓
candidate_complete
   ↓
重新 observe
   ↓
VerificationEngine
   ↓
PASS / FAIL / INCONCLUSIVE
```

其中：

```text
INCONCLUSIVE = 不完成
```

Verifier 输入只允许：

```text
用户目标
completion criteria
当前环境
Task Artifact
结构化 evidence
```

**Verifier 不读取 Executor 的 reasoning。**

避免 Agent 自己给自己证明。

模型层原则（配套，非本轮强制拆三模型）：

```text
Planner Model
Executor Model
Verifier Model
```

全部可交换。甚至不一定三个模型不同，只是三个独立评测槽位。模型不再成为“产品架构决定”。

---

## 14. Verifier 扩展

保留已有：

```text
url
page_text
element_state
media_state
tab_state
download_state
```

新增：

```text
artifact_exists
artifact_contains
artifact_schema
artifact_row_count
artifact_source_count
```

例如：

```text
任务：
“抓取至少 10 件商品，输出名称、价格和评分。”

Verifier：

artifact_exists = true
artifact_schema = [name, price, rating]
artifact_row_count >= 10
artifact_source_count >= 1
```

LLM Judge 只能用于难以确定性判断的语义质量。

例如：

```text
“这份研究报告是否回答了用户提出的三个问题？”
```

即使使用 Judge：

**Judge 不能覆盖确定性 Verifier 的失败结果。**

---

## 15. Trace

每次任务 Trace 增加：

```text
kernel.observe
observation.diff
skill.discover
skill.run
kernel.act
artifact.create
verify
```

Skill span 必须记录：

```text
skill_id
skill_version
candidate_count
selected_reason
duration
outcome
fallback_used
```

Observation span：

```text
frame_id
page_revision
full_chars
rendered_chars
diff_chars
material_change
```

Verifier：

```text
criteria
passed
failed
inconclusive
evidence_ref
```

现有隐私纪律继续执行。

不得记录：

```text
Cookie
password
完整表单值
完整页面正文
完整私人 prompt
```

---

## 16. Feature Flags

新增：

```text
enableBrowserKernelV1
enableObservationDiff
enableSkillRuntime
enableLearnedSkills
enableArtifactVerification
```

上线过程中必须可以逐个关闭。

禁止一次性“大重构切换”。

---

## 17. 实施顺序

### Phase 0：冻结 Baseline

不改代码。

按照 020，用当前 commit 在相同模型和相同 attach mode 下跑基线。

至少覆盖：

```text
013-A01
013-A03
013-B04
013-B05
013-B06
013-B07
013-B08

018-O1
018-R1

021-LH-01
021-LH-02
021-LH-03
```

记录：

```text
TSR
false_complete
wrong_tab
latency
prompt chars
failure_class
```

后续所有架构改动和这个 baseline 比。

020 已经规定，同一 Harness 实验必须固定 task_id、git sha、model、attach mode 和证据路径。

### Phase 1：Browser Kernel

只做接口抽取。

行为必须完全一致。

完成：

```text
observe()
act()
extract()
waitFor()
```

`control-llm` 改走 Kernel。

此阶段 Skill / Diff 默认关闭。

验收：

> Phase 0 baseline 无显著下降。

### Phase 2：Observation Diff

加入 Frame + Diff。

先 shadow mode：

```text
仍给模型旧 Observation
同时计算 Diff
只记录、不参与决策
```

确认稳定后：

```text
enableObservationDiff=true
```

目标：

**长程任务 Observation payload 中位数下降 ≥30%，TSR 不出现显著下降。**

### Phase 3：Skill Runtime

实现：

```text
SkillManifest
SkillRegistry
SkillDiscovery
SkillRuntime
run_skill
```

先迁移当前确定性逻辑。

验收：

```text
control-llm.ts 不再包含具体网站业务规则
```

原任务成功率不得因为迁移下降。

### Phase 4：Artifact + Verifier

加入：

```text
TaskArtifact
artifact criteria
VerificationEngine
```

把 R1 这种：

```text
summary 里看起来有 CSV
```

升级成：

```text
真实 table artifact
+
schema verifier
+
row count verifier
```

### Phase 5：Learned Skill

接现有 Outer Loop。

流程：

```text
Trace
→ candidate
→ SkillPlan
→ eval
→ promotion
```

晋升纪律沿用 019：

```text
R >= 9
false_complete = 0
无敏感字段
不同输入重跑 >= 3
```

---

## 18. 新增 Eval Tasks

按照 020 的纪律，先登记 task，再实现。

建议新增：

| task_id | 测试什么 |
| --- | --- |
| 022-KERNEL-01 | Kernel 与旧路径行为一致 |
| 022-DIFF-01 | 连续 10 步页面变化，Diff 正确 |
| 022-SKILL-01 | generic list skill 完成表格提取 |
| 022-SKILL-02 | Skill 失败后成功回退通用 Agent |
| 022-VERIFY-01 | Executor 假报 done，Verifier 必须拒绝 |
| 022-ARTIFACT-01 | 表格字段、行数、来源验证 |
| 022-LEARN-01 | Candidate Skill 换输入 3 次通过后晋升 |

---

## 19. Release Gate

022 只有满足下面条件才能标记 `current / shipped`：

| Gate | 要求 |
| --- | --- |
| Regression | 相对 Phase 0 baseline 不出现显著 TSR 下降 |
| False Complete | **0** |
| Wrong Tab | **0** |
| Core purity | `control-llm.ts` 无网站特判 |
| Side effects | Skill 100% 经 `dispatchAction` |
| Observation | Diff 模式 payload 中位数降低 ≥30% |
| Skill fallback | Skill 失败不导致任务直接死亡 |
| Verification | Skill/Executor 无权自行 completed |
| Trace | Skill、Diff、Artifact、Verifier 全部可诊断 |
| Privacy | 原有敏感数据检查全部通过 |

---

## 20. 明确的非目标

本轮不做：

```text
重写 Chrome Extension
接 Python Browser Use sidecar
把 Stagehand 作为核心依赖
云浏览器
多 Agent orchestration
跨用户 Memory
模型微调
Skill Marketplace
任意动态 JS 生成执行
一次性重写 ActionBuilder
```

---

## 21. 工程最终状态

022 完成以后，Scion 的执行路径应该收敛成：

```text
User Goal
   │
   ▼
Mission / Plan
   │
   ▼
Agent Policy
   │
   ├──── discover ────► Skill Registry
   │                       │
   │                       ▼
   │                   Skill Runtime
   │                       │
   └──────────────┬────────┘
                  ▼
             Browser Kernel
                  │
       ┌──────────┼──────────┐
       ▼          ▼          ▼
    observe      act       extract
       │          │          │
       └──────── Chrome ─────┘
                  │
                  ▼
         Observation Diff
                  │
                  ▼
             Artifact
                  │
                  ▼
       Independent Verifier
                  │
          ┌───────┴────────┐
          ▼                ▼
       complete       continue/fail
```

工程团队如果只记一句，就是：

> **把网站知识从 Agent Core 拿出去，把成功判断从 Executor 拿出去，把重复页面信息从 Context 拿出去，把成功轨迹变成真正可以再次调用的 Skill。**

这四刀做完，`scion` 才真正从 Nanobrowser 的二开，进入自己的 Browser Agent Harness 阶段。

---

## 22. 参考

- `product/019`：Harness 五要素、Trajectory → Skill candidate、晋升纪律
- `product/020`：统一评估协议、baseline 固定字段
- `product/021`：长程任务 Agent 北极星
- `decisions/001`：保留 Chrome 扩展作为最终产品形态
- `decisions/002`：质量优先、Agent Core 可替换
- `design/002`：control 默认核与可换 ExecutorDriver
- `design/007`：Snapshot Frame / pageRevision / stale reject
