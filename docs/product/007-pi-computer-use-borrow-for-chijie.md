---
title: "从 pi-computer-use 可借鉴什么（持节）"
description: "研读 injaneity/pi-computer-use 后，写清持节该借的控制论与状态机、明确不借什么、以及建议落地顺序。供转发对齐。"
category: "product"
number: "007"
status: current
services: ["projects/chijie-browser"]
related: ["product/001", "product/003", "product/005", "design/001", "design/002", "decisions/001"]
last_modified: "2026-07-15"
source: "https://github.com/injaneity/pi-computer-use"
---

# 007 — 从 pi-computer-use 可借鉴什么（持节）

**读者：** 持节协作者（可直接转发）。  
**目的：** 说清外部项目是什么、持节具体借什么、不借什么、建议落地顺序。  
**外部源：** [injaneity/pi-computer-use](https://github.com/injaneity/pi-computer-use)（MIT；Pi 扩展，macOS / Windows 桌面 Computer Use）。

---

## 1. 对方在解决什么

`pi-computer-use` 让 **Pi agent** 操作**桌面上的普通图形应用**（以及同一套模型下的浏览器页）：

- 找已打开的 app / 窗口 / 页面根
- 观察窗口或页里可见结构
- 搜索、展开、细查控件
- 点击、输入、滚动、按控件
- 等待界面变化

官方边界：**有可靠 API / MCP 时优先接口**；Computer Use 适合「只能点界面」的软件。

主循环（架构文档原意）：

```text
find roots → observe one root → search / expand / inspect → act from that state
```

关键公共工具：`find_roots`、`observe_ui`、`search_ui`、`expand_ui`、`inspect_ui`、`act_ui`、`read_text`、`wait_for` 等。

---

## 2. 和持节的关系

| | **持节（Chijie）** | **pi-computer-use** |
|--|-------------------|---------------------|
| 主战场 | 用户日常 **Chrome** 里的多步网页任务 | Pi agent 的桌面 / 浏览器 Computer Use |
| 成功标准 | 可验证完成 + 关处批准 + Tabbit 级准确率（见 `product/003`） | 能稳定操作无 API 的桌面软件 |
| 载体 | Chrome 扩展 + 可换执行核 | Pi 扩展 + 原生 helper（AX / UIA 等） |

### 结论

**持节只借控制论与状态机，不集成整仓。**

- 持节域是**浏览器行动 Agent**（见 `decisions/001`：保留 Chrome 扩展载体）。
- 需要的是：观察不可变、动作可验、过期拒绝、假完成压到零。
- 与 pi 的状态机高度同构，但实现应落在持节 Task 壳 / 执行核内。
- 不把桌面 Computer Use 做成持节产品目标（偏离 `product/003`）。

---

## 3. 持节应借鉴的清单（按优先级）

### P0 — 直接服务 verified completion / 反假完成

| 对方做法 | 含义 | 落到持节 |
|----------|------|----------|
| **每次观察有 `stateId`，元素 ref 只属于该 state** | 没有「全局当前 UI」被随便改写 | 每轮 DOM / a11y 快照钉 `pageRevision` 或等价 id；动作必须携带 |
| **动作基于同一 `stateId` 的 `@e` ref** | 过期 ref 不能蒙对 | 旧 revision 上的 click/type **拒绝执行**，强制再观察 |
| **`act` + `expect` 后置条件** | 事件送出 ≠ 业务成功 | 提交、发送、暂停等：等到约定文案 / 角色 / URL / 媒体状态，超时 = 未完成 |
| **结果三态：`worked` / `didnt` / `unknown`** | 不确定不装成功 | `unknown` 不得进 `completed`；须再 observe 或转 `waiting_user` / `failed` |
| **能力声明 ≠ 结果证明** | AX/可点不保证真生效 | 与现有 criteria/evidence 对齐：页面证据优先于模型 `done` |

与现有资产的咬合：

- 持节已有：`criteria` / `evidence` / `waiting_approval` / `proof_required`（见 Task 壳与 `completion` 相关实现）。
- 缺口：把 **「动作已交付」** 和 **「语义已成立」** 在执行核协议里写死，而不是只在 UI 文案层。

### P1 — 降 token、稳调度

| 对方做法 | 落到持节 |
|----------|----------|
| **渐进披露**：先折叠 outline，再 search / expand / inspect | 勿每步整页 HTML 灌模型；先结构摘要，再局部展开 |
| **按物理资源串行**（同窗口 / 同 tab），跨资源可并行 | 同 tab 动作互斥；多 tab 策略以后再开 |
| **resource epoch：过期写拒绝** | 与 `pageRevision` 同一思想 |
| **动作后 successor diff** | 回传「变了什么」而不是整棵树，省上下文 |

### P2 — 动作批处理纪律

| 对方做法 | 落到持节 |
|----------|----------|
| 多步 `actions[]` 仅当**中间不必再观察** | 例如连续填表字段；点提交前后必须拆步 |
| 失败带 `stoppedAt` | 便于回执与重试边界 |
| 可编辑区 click 后键盘步骤继承焦点 | 表单旅程减少丢焦点误输入 |

---

## 4. 明确不借鉴 / 不集成

| 项 | 原因 |
|----|------|
| 把 pi-computer-use 装进持节扩展当依赖 | 产品边界不同；权限（辅助功能 / 录屏）与 Chrome 扩展模型冲突 |
| 做成「通用桌面 Computer Use」 | 偏离 `product/003` 北极星（浏览器行动 + Tabbit 对齐） |
| 用截图坐标点击当默认策略 | 对方也强调语义 / a11y 优先；坐标仅绑定带图像的 state |
| 为对标而引入 Pi 运行时 | 持节壳与 Task 契约自建（`design/002` 可换核） |

---

## 5. 建议落到持节的最小协议（可给实现同学）

目标形态（逻辑层，名称可改）：

```text
observe(root) → { stateId, outline }
search | expand | inspect (stateId, …)   // 缓存树上查询，默认不再截屏
act({ stateId, actions, expect? }) → { outcome: worked|didnt|unknown, nextStateId?, evidence }
wait_for({ stateId | root, condition, timeoutMs })
```

硬规则：

1. 凡 mutate，必须带 `stateId`（或 `pageRevision`）。
2. `expect` 失败或 `unknown` → **不得**标任务 `completed`。
3. 外部提交（发送、支付、公开发帖等）仍走现有 **批准（节）**；批准只授权动作，**不替代** `expect` 证据。
4. 与 `product/005` 黄金旅程：飞书 / B 站验收时，后置条件写进协议（可见成功信号是什么）。

当前里程碑提醒（`product/003`）：默认仍是 **M3 真实站 verified**；本借鉴应服务 M3，而不是另开桌面大项目。

---

## 6. 转发用一页摘要

**pi-computer-use 是什么**  
Pi 的 macOS/Windows 桌面 Computer Use 扩展：看窗口、点 UI、等变化。

**持节**  
不集成该仓库；借鉴四件事：

1. 不可变观察 + `stateId`
2. 动作必须带 state，过期拒绝
3. `act` + `expect`，交付 ≠ 成功
4. `worked` / `didnt` / `unknown`，未知不当完成

**当前优先级**  
用上述协议服务 **M3 飞书 / B 站 verified**，不新开桌面线。

---

## 7. 参考链接

- 仓库：https://github.com/injaneity/pi-computer-use
- 架构：仓库内 `docs/architecture.md`
- 用法：仓库内 `docs/usage.md`
- 持节北极星：`docs/product/003-north-star.md`
- 黄金旅程：`docs/product/005-golden-journeys-protocol.md`
- 可换核：`docs/design/002-production-core-swap.md`

---

## 8. 实现进度（P0）

| 项 | 状态 | 落点 |
|----|------|------|
| `pageRevision` / state 绑定 | **done** | `task/page-state.ts` + `ActionDispatcher` auto-revision |
| 过期 revision / target 拒绝 | **done** | `assertMutableStateBinding`；rawArgs 可带 `pageRevision`/`stateId` |
| `act` + expect 证据 | **partial** | after-observe `evidence` → `classifyActOutcome`；完整 expect 字段待核 |
| `worked` / `didnt` / `unknown` | **done** | `DispatchResult.actOutcome`；external_commit 无 expect → `unknown` |
| unknown 不得 verified complete | **done** | `allowsVerifiedComplete` 闸门 + 既有 `checkCompletion` |

测试：`page-state.test.ts` + dispatcher 007 cases。

## 9. 修订

| 日期 | 说明 |
|------|------|
| 2026-07-15 | 初版：基于 pi-computer-use README + architecture/usage；持节借鉴清单 |
| 2026-07-15 | 修订：去掉非持节产品线内容；文档范围仅限持节 |
| 2026-07-15 | P0 落地：page-state 协议 + ActionDispatcher 过期拒绝与三态 outcome |
