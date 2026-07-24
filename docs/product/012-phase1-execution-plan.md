---
title: "Phase 1 执行计划：持续推进与关键人机验收"
description: "Browser Agent Parity 的可执行计划：切片、自动验收、仅在关键节点请 Owner 真机体验。"
category: "product"
number: "012"
status: current
services: ["projects/chijie-browser"]
related: ["product/011", "product/003", "product/008"]
last_modified: "2026-07-23"
---

# 012 — Phase 1 执行计划

## 协作契约（本对话默认）

| 谁 | 做什么 |
|----|--------|
| **Agent** | 写清计划 → 持续实现 → 自动验收（测/构建/脚本）→ 记证据 |
| **Owner** | **只在关键节点**真机体验；产品取舍；是否放行下一阶段 |
| **禁止** | 每一步都等人；把 Memory/平台终局塞进 Phase 1 |

阶段纪律见 `product/011`。  
当前只做 **v0.1 → v0.2（Parity / Reliable）**。

## 北极指标

**Task Success Rate (TSR)** on a fixed task set:

```text
TSR = verified_pass / attempts
```

- verified = 页面可观察结果，不是模型口头 done  
- 同步记录：平均耗时、失败分类（错页 / 看不懂 / 点错 / 卡住 / 超时）  
- **固定任务集与换核对打协议：`product/013-quality-first-tsr-bakeoff.md`（出身归零）**

## 里程碑与人机闸门

| ID | 里程碑 | Agent 自动完成 | **请你体验（关键节点）** | 通过标准 |
|----|--------|----------------|--------------------------|----------|
| **M0** | 计划与纪律冻结 | 011 + 012 文档 | 无需 | 文档可读、范围无 Phase 2 |
| **M1** | 当前页绑定可信 | 绑定证据 UI + 校验 + 单测 | **H1 真机** | 侧栏显示绑定 title/url；「识别当前页」对准人眼 active tab |
| **M2** | 理解+行动最小闭环 | 固定动作集稳定；失败可分类 | **H2 真机** | 3–5 条 parity 任务可重复跑；无系统性错页 |
| **M3** | Reliable 雏形 | retry/recovery + 评测表骨架 | **H3 真机** | 同一任务集跑 2 轮，TSR 与失败分类可对比 |
| **M4** | Phase 1 出口 | 评测集 ≥N 与基线报告 | **H4 放行** | 你认为「能托付基础浏览器任务」再开 Phase 2 接口加厚 |

非关键节点：Agent **不打断**；只在 M1/M2/M3/M4 的 H* 请你点侧栏。

## 切片 backlog（严格顺序）

### S1 — Active tab bind（M1）← 当前

- 解析可靠 active content tab（侧栏打开时仍对准用户页）
- 发送/开任务前写入绑定 `tabId + title + url`
- 侧栏可见「正在读：…」
- 观察前校验：任务 `activeTabId` 与页一致，否则诚实失败/重绑提示
- 单测覆盖纯逻辑

### S2 — Observe quality（M2）

- semantic grounding 与状态摘要含 url/title
- 错页/不可访问 URL 可分类失败

### S3 — Action reliability（M2）

- click/type/navigate 后 re-observe
- 无进展检测（已有 no_progress 则加固）

### S4 — Eval harness（M3）

- 固定任务列表（本地 fixture + 可选公开站）
- 跑分脚本或手工表模板 → `reports/`

### S5 — Retry / recovery（M3）

- 有限重试、目标丢失重绑策略

**不做（Phase 1）：** Preference/Workflow/Procedural memory 产品实现；图谱；Agent 平台叙事。

## 自动验收（每切片）

```bash
cd projects/chijie-browser
pnpm -F chrome-extension test   # 触及的包
pnpm build                      # 需要时
```

证据写入 `reports/nanobrowser/`（历史目录名，产品名仍是持节）。

## 当前状态

| 项 | 状态 |
|----|------|
| M0 纪律 | done（011） |
| M0 计划 | done（本文件） |
| S1 Active tab | **auto-green**（绑定 chip + 解析 + start 种 page target + 单测） |
| H1 | **请你体验**（见文末 H1 卡） |

## 下一动作（Agent）

1. ~~完成 S1 实现 + 单测~~  
2. ~~自动验收绿~~  
3. **等 H1**（你点侧栏；反馈错页/对页）  
4. H1 通过后进 S2（observe quality），不回头堆 Memory  

## H1 体验卡（关键节点 · 约 2 分钟）

前置：`pnpm build` 后 Chrome Load unpacked `projects/chijie-browser/dist`，侧栏打开持节。

1. 打开 **B 站某个视频页**，保持该标签为当前标签。  
2. 看侧栏输入框上方 **「正在读」** 是否显示 bilibili + 视频标题。  
3. 发送：`识别当前页面在放什么`（或「用一句话总结当前页」）。  

**Pass：** 绑定条对准该视频；回答是该页内容，不是别的标签（如 ChatGPT）。  
**Fail：** 绑定条错页，或回答明显不是当前视频。  

体验后回一句：`H1 pass` 或 `H1 fail: <现象>`。  
