---
title: "先对标再差异：Browser Agent Parity 优先"
description: "持节当前阶段只做可靠浏览器操作；Task Success Rate 为王；三核理解/行动/闭环；记忆只预留接口不实现。"
category: "product"
number: "011"
status: current
services: ["projects/chijie-browser"]
related: ["product/003", "product/008", "product/009", "decisions/001", "CONTEXT"]
last_modified: "2026-07-23"
---

# 011 — 先对标再差异：Browser Agent Parity 优先

## 一句话

**现在只做「会走路」：可靠替用户操作浏览器。**  
不先设计 Agent 平台终局（Permission / Evidence / Memory / Planner 堆叠）。  
先达到 Sider Claw / browser-use / Operator 类产品的 **基本能力**，再用本地化 + 记忆做差异。

## 类别

持节参与的是：

**Computer Use Agent / Browser Agent**

第一阶段用户问的是：

> 你能不能可靠地替我操作浏览器？

不是：

> 你的 memory architecture 好不好看？

第一次打开：订票 / 打开某站 / 填表。  
找错站、点错钮、卡住 → 卸载。  
用户不会因为架构图留下。

## 推理顺序（硬）

```text
产品竞争问题
  → Phase 1 能力对标（可靠操作）
  → 工程三核（理解 / 行动 / 闭环）
  → 评测（Task Success Rate）
  → Phase 2 差异（记忆与飞轮）
  → 终局（Personal Browser OS）
```

**禁止：** 看到终局就设计终局；把未来架构和当前阶段混写进同一 sprint。

错误示范：先排 Permission System、Evidence Layer、Memory、Planner、Executor 的「平台蓝图」。  
正确示范：先确认户型（能可靠点网页），再谈消防与物业（记忆与技能复利）。

## Phase 1 — Browser Agent Parity

### 目标

**不是创新。**  
达到同类产品的基本能力，对标对象包括但不限于：

- Sider Claw 类浏览器侧 Agent
- browser-use 类浏览器操作环
- OpenAI Operator 类 Computer Use 体验（能力级，不抄壳）

能力与体验上，`product/003` 仍以 Tabbit 披露准确率为 **质量标尺**；  
**当前里程碑优先级** 以本文 Phase 1 为准：先可靠，再谈宣称对齐 91.8%。

### 唯一主指标：Task Success Rate

不是代码量、不是模块数。

例：固定任务集 100 条：

| 看什么 | 记什么 |
|--------|--------|
| 成功多少 | verified pass / attempt |
| 平均完成时间 | 墙钟时间 |
| 失败原因 | 可分类：看不懂 / 点错 / 卡住 / 超时 / 绑定错页 |

「成功」必须绑定 **页面可观察结果**，禁止模型口头 done。

### 工程只认三核

#### 1. Browser Understanding

Agent **看懂** 当前页。

- DOM / accessibility tree
- screenshot（需要时）
- semantic element grounding（「提交按钮」不是「第 23 个 div」）
- **active tab / 当前页绑定** 与人眼一致（错页即失败）

#### 2. Browser Action

Agent **能行动**。

- click / type / scroll / navigate
- upload / download（在策略允许时）
- 在 **用户日常 Chrome** 里执行（见 `decisions/001`）

#### 3. Agent Loop

真闭环，不可省略 re-observe：

```text
Observe → Reason → Act → Observe result → Continue
```

失败要可分类、可有限重试；假完成 = 产品事故。

### Phase 1 明确不做

- 完整 Permission 平台叙事（保留已有「外部提交一次批准」即可，不扩平台）
- Memory 产品实现（Preference / Workflow / Procedural 全后置）
- Knowledge Graph / 跨会话人格
- 多 agent 军团平台化
- 为「终局 OS」预建的空壳中台

## Phase 2 — 持节差异化（后置）

**时机：** Phase 1 任务成功率在固定评测集上稳定可托付之后。

差异不是「多存聊天记录」。

### 记忆三层（产品语义，未实现）

| 层 | 含义 | 例 |
|----|------|-----|
| Preference | 偏好 | 要表格不要长文；购物优先日系 |
| Workflow | 习惯工作流 | 每周固定站 → 整理 → 发信 → 报告 |
| Procedural | 可复用技能 | 竞品分析：去哪、看哪些字段、输出格式 |

### 飞轮（终局叙事，不提前施工）

```text
使用 → 行为数据 → 个人记忆 → 更懂用户
  → 成功率↑ → 更多使用 → 更多数据
```

这是护城河叙事；**当前代码不实现飞轮。**

## Memory：现在不实现，必须预留接口

**现在（v0.1–v0.2）：**

```text
Task Event
    ↓
Memory Interface（稳定、可空实现 / no-op）
    ↓
Local Storage（最小落盘或丢弃，按接口契约）
```

**未来（v0.3+，可换实现）：**

```text
Memory Interface
    ↓
Personal Knowledge Graph / Episodic / Procedural Skills
```

规则：

- 任务环只依赖 **接口**，不依赖具体存储形态。
- 禁止在 Phase 1 为「以后好用」把图谱/向量库做成阻塞项。
- 接口变更走文档 + 小 diff；实现后置。

## 版本压缩路线

| 版本 | 名字 | 只做什么 |
|------|------|----------|
| **v0.1** | Browser Agent | Extension 壳、Browser control、Agent loop、Task state、Basic logging |
| **v0.2** | Reliable Agent | retry、recovery、evaluation、固定 benchmark / 失败分类 |
| **v0.3** | Personal Agent | memory 三层、preference、workflow learning、reusable skills |
| **v1.0** | Personal Browser OS | 在 v0.3 飞轮成立后的完整工作入口（非现目标） |

当前开发会话默认落在 **v0.1 → v0.2**。  
任何 PR / agent 任务若引入 v0.3 范围，必须 Owner 显式批准。

## 与既有文档关系

| 文档 | 关系 |
|------|------|
| `003` 北极星 | 终局质量标尺仍有效；**阶段优先级以 011 为准** |
| `008` 任务环规格 | Phase 1 的环与验收细节 |
| `009` Tabbit 差距 | 缩差时先做「可托付真实任务」，与 011 一致 |
| `CONTEXT.md` | 词汇与 MVP 边界；跨会话记忆仍 out of cycle |
| `006` 外环 RL | 仍 draft，不抢 Phase 1 |

## 给实现者的检查清单

开工前自问：

1. 这是在提高 **Task Success Rate**，还是在堆平台名词？  
2. 是否落在 **Understanding / Action / Loop** 三核之一？  
3. 是否可用固定任务集证明变好/变坏？  
4. 是否偷偷做了 Memory 实现而非接口预留？  
5. 是否把 v1.0 的设计塞进了 v0.1？

任一答错 → 停，回到 Phase 1。
