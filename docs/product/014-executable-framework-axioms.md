---
title: "可执行框架公理（指哪打哪）"
description: "持节底层六层 + 展示层反泄漏；人话产品面与工程附录分离；A→C 能力路径服从 decisions/003。"
category: "product"
number: "014"
status: current
services: ["projects/chijie-browser"]
related:
  - "product/003"
  - "product/007"
  - "product/008"
  - "product/011"
  - "product/013"
  - "decisions/001"
  - "decisions/002"
  - "decisions/003"
  - "design/002"
  - "design/004"
  - "CONTEXT"
last_modified: "2026-07-23"
---

# 014 — 可执行框架公理（指哪打哪）

## 一句话（产品）

持节要在用户正在用的 Chrome 里，听懂一句话、做对页面上的事、用看得见的结果收工。  
底层可以极致；**侧栏永远不要像调试台。**

## 用户只需要看见什么

| 看见 | 含义 |
|------|------|
| 目标 | 我让它干什么 |
| 状态 | 在忙 / 等我批准 / 做完了 / 需要我帮忙 |
| 步骤 | 人话：打开了哪、点了什么、是否生效 |
| 结果 | 做成了什么证据；或为什么停、我下一步做什么 |
| 批准卡 | 仅在「会真的提交/发送/购买…」时出现 |

用户**不应**看见：Planner、Navigator、`step_failed`、`observe_failed`、`ExecutorDriver`、`pageRevision`、`failure_class` 原文、`no_progress`、JSON 工具名、核名称（nano/control）等。

---

# Part A — 产品公理（人话）

### A1. 任务，不是闲聊

侧栏任务模式 = 委托浏览器干活。闲聊可以存在，但不冒充「已完成网页动作」。

### A2. 指的是人眼这一页

「这个 / 当前 / 这个视频」默认绑人正在看的标签与对象。指错页 = 失败，不是差不多。

### A3. 做了要能看见

页面（或下载栏、tab 列表）上有变化，才算进展。助手说「好了」不算。

### A4. 危险一步先问

会提交、发送、购买、删除、改权限的动作：先停、说清楚、批一次、只执行那一次。

### A5. 卡住说人话

登不进去、要点的找不到、页面变了、这类视频保存不了——用完整句子说明，并给一个可做的下一步。不要甩错误码。

### A6. 会越来越懂你（后置）

先把 A1–A5 做稳。本地偏好与技能是下一阶段；接口现在预留，不在产品上假装已经有「人格记忆」。

### A7. 能力只深不飘

现在把扩展本体做可靠（能力 A）。  
方向是控制深度越来越接近原生级 Agent（能力 C）。  
中间可以加本地助手肌肉，用户仍只装一个插件。  
详见 `decisions/003`。

---

# Part B — 工程附录：六层可执行框架

示例（关页、播停、下载、抓取）只是**探针**，不是框架本身。框架 = 任意意图可编译为：

```text
附着正确世界 → 感知可引用状态 → 有限原语组合 → 再观察 → 证据裁决完成
```

## B0. 总图

```text
┌─────────────────────────────────────────────────────────┐
│  Presentation（侧栏）  人话 · 零内核泄漏 · design/004     │
└──────────────────────────▲──────────────────────────────┘
                           │ ViewModel / i18n only
┌──────────────────────────┴──────────────────────────────┐
│  L4 Task 壳  TaskManager · 审批 · 回执 · CompletionChecker │
└──────────────────────────▲──────────────────────────────┘
                           │ ExecutorDriver 窄接口
┌──────────────────────────┴──────────────────────────────┐
│  L3 Agent Loop   observe → decide → act → re-observe      │
│  （control / 可换核；不得自封 completed）                   │
└──────────────────────────▲──────────────────────────────┘
                           │ hooks.dispatchAction
┌──────────────────────────┴──────────────────────────────┐
│  L2 Action surface   原语注册表 + EffectPolicy             │
└──────────────────────────▲──────────────────────────────┘
                           │ BrowserContext / Page / helper
┌──────────────────────────┴──────────────────────────────┐
│  L1 Perception + Attach   tab 真相 · 快照 · media digest  │
│  （可选 companion：CDP / Native host → A→C）               │
└─────────────────────────────────────────────────────────┘
```

## B1. World attach（附着）

| 规则 | 说明 |
|------|------|
| 真相源 | 人眼 `active tab` + URL；任务绑定 `tabId` |
| 错绑 | 记 `wrong_tab` / bind_miss；**不得**对用户打印该码，映射为人话「我好像不在你正在看的页面上」 |
| 禁止 | 用侧栏会话历史页冒充当前页（OpenClaw 类坑） |

## B2. Perception（感知）

| 规则 | 说明 |
|------|------|
| 每帧 | 观察产出 `stateId` / pageRevision + 可引用目标 |
| 过期 | 动作必须携带观察世代；过期 ref **拒绝执行**，强制再观察（见 product/007） |
| 披露 | 先结构摘要，再按需展开；避免整页 HTML 灌模型 |
| 媒体 | 候选 + digest；连续控制继承 digest |

## B3. Action surface（原语）

原语要**少、稳、可验证**，靠组合表达「什么都能做」：

```text
tab: focus | close | open | switch
nav: goto | back
dom: click | type | scroll | select | wait
media: play | pause | seek   （元素 API 优先）
io: extract | download_*     （按能力档，非无限咒语）
meta: done_candidate         （只申报，CompletionChecker 裁决）
```

下载等深度能力：发现 → 分类（progressive / hls / drm）→ 原语或 companion → 证据。  
DRM：内部 `drm_blocked`；对用户：「这类受保护内容暂时保存不了」。

## B4. Agent loop（环）

```text
Observe → Decide → Act → Re-observe → …
```

| 规则 | 说明 |
|------|------|
| 结果三态 | worked / didnt / unknown；unknown **不得** completed |
| 完成权 | 仅 Task 壳 + CompletionChecker；核禁止直写 completed |
| 无进展 | 熔断；内部 `no_progress` → 人话「反复试了还是没进展」 |
| 可换核 | `ExecutorDriver`；质量优先替换（decisions/002） |

## B5. Binding & continuous control（指代）

- 「这个 / 停一下 / 继续」解析到任务内 `targetRef` / media digest。  
- 无对象 → `waiting_user` + 人话问清；不瞎点第一个控件。

## B6. Policy & evidence（策略与证据）

- 外部提交：一次性批准，目标变则作废。  
- 回执：目标、证据摘要、时间；**回执展示脱敏**，不含 cookie / 表单原文。  
- 假完成 = 产品事故（`false_complete` 仅评测/日志）。

## B7. A→C 接缝（复利）

| 阶段 | 工程 | 用户感知 |
|------|------|----------|
| A | 纯扩展可靠环 | 「插件好用」 |
| A+ | Native host / 可选 CDP 肌肉 | 仍是持节；更稳更深 |
| C 向 | 附着与控制深度逼近原生 harness | 仍尽量不换浏览器；换壳须重开 001 |

Memory 接口预留在 Task 壳外或旁路；Phase 1 禁止假记忆产品。

---

# Part C — Presentation leakage（展示层泄漏）— 硬禁止

## 定义

**Presentation leakage** = 把执行核、协议、评测用的内部状态或符号，未经映射就暴露到用户主 UI。

## 禁止出现在主侧栏（默认任务 UI）

- 角色/核名：`Planner`、`Navigator`、`Executor`、`sisyphus`、`nano`、`control` 后端名  
- 原始失败：`step_failed`、`observe_failed`、`json_parse_failed`、`no_progress`、`llm_failed`  
- 协议字段：`pageRevision`、`stateId`、`ExecutorDriver`、`failure_class`、`attach_mode`、`ActionAttempt.state` 英文枚举当正文  
- 模型/工具原始 JSON、`<think>`、工具 schema 名当步骤标题  
- 假进度：无可信总数时的 `%`、`3/10` 步骤条  

## 允许的内部通道（不叫泄漏）

| 通道 | 条件 |
|------|------|
| 日志 / 远程诊断（若开启） | 默认关；非主任务卡 |
| Options「高级 / 开发」 | 明确标注高级；默认用户路径碰不到 |
| 评测 CSV / reports/ | 开发者资产 |
| 单测断言内部码 | 测试代码 |

## 映射义务

任何用户可见字符串必须经 **presentation 层** 产出：

| 内部 | 用户（示例，以 i18n 为准） |
|------|---------------------------|
| `waiting_approval` | 等待批准 |
| `observe_failed` / `selector_miss` | 没找对要点的位置 / 正在重试读页 |
| `login_wall` | 需要你先登录 |
| `false_complete`（若必须说） | 还不能确认已经完成 |
| `drm_blocked` | 这类受保护内容暂时保存不了 |
| `control_media` | 媒体控制 / 已暂停视频（结合结果） |

代码锚点（已有，必须保持）：

- `pages/side-panel/src/presentation/task-loop-ui.ts` — `isMachinePrimaryCopy`  
- `pages/side-panel/src/presentation/failure-taxonomy.ts` — `toProductFailureCode` / `isEngineerFailureNoise`  
- `pages/side-panel/src/components/TaskStatusCard.tsx` — 失败/等待映射  
- `pages/side-panel/src/design/__tests__/ui-acceptance.test.ts` — 禁 Planner/step_failed  
- 文案表：`design/004` Phase copy  

**新 UI 不得** `String(error)` 或 `attempt.failureCategory` 直出主界面。

## 验收（反泄漏）

1. 侧栏主路径人工扫：无 Planner/Navigator/step_failed/observe_failed 字样。  
2. `ui-acceptance` 与相关 presentation 单测绿。  
3. 北极星可见形态（product/003）：「侧栏只见你/助手、目标、状态、下一步」。

---

# Part D — 与现有文档的关系

| 文档 | 关系 |
|------|------|
| `003` 北极星 | 可见形态与闸门；本文补「框架公理」 |
| `007` pi 借鉴 | stateId / expect / 三态 → B2–B4 |
| `008` 任务环 | UX 规格；本文补分层与反泄漏 |
| `011` Parity | Phase 1 只做会走路；服从 |
| `013` bake-off | TSR 验框架，不验话术堆功能 |
| `decisions/003` | A→C 与双声口；本文落地 |
| `design/002` | 生产环与可换核 |
| `design/004` | 冷静任务台文案；反泄漏的视觉源 |

## 非目标

- 本文不新增功能清单式 roadmap。  
- 本文不授权 Phase 1 实现完整 Memory 产品。  
- 本文不授权 fork Chromium。
