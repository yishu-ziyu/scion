---
title: "质量优先，Agent Core 可替换"
description: "质量高于沉没成本；保留 Chrome 扩展产品层，允许替换 NanoBrowser 原版 Agent 执行核。"
category: "decisions"
number: "002"
status: current
services: ["projects/nanobrowser/chrome-extension"]
related: ["decisions/001", "product/001", "design/001"]
last_modified: "2026-07-15"
---

# 002 — 质量优先，Agent Core 可替换

## 状态

已决定（2026-07-15）。与 `decisions/001`（保留 Chrome 扩展载体）同时成立，不冲突：

- **001**：执行发生在用户日常 Chrome / 扩展内，不 fork 浏览器、不默认上云浏览器。
- **002**：扩展内的 **Planner/Navigator 执行核可以整体替换**；质量不够时必须大胆改，不保护沉没成本。

## 原则

1. **质量第一。** 正确性、安全、可验证完成、隐私、可维护性优先于交付速度与“已经写了多少”。
2. **该改就改。** 若继续修补原版 Agent Core 的成本接近重写，或两轮根因修复后仍达不到 PRD 闸门，则替换执行核，而不是继续堆功能。
3. **壳与核分离。** 产品层（侧栏、Task/Round、审批、完成回执、Skill、本地登录态）是要护的；Nano 原版 Agent Core 不是护城河。
4. **证据决策。** 换核或只换模型，都必须先走同题 bake-off，用 PRD 指标说话，不用 star 数或口碑替代验收。

## 决策

| 层 | 策略 |
|---|---|
| L4 产品契约 | 自建并保留：Task / Round / 外部提交审批 / 可验证完成 / 回执 / Skill / 隐私边界 |
| L3 产品壳 | 保留 Chrome 扩展 + 侧栏 + 用户登录态（见 001） |
| L2 Agent 执行核 | **允许替换**；默认不长期押注 Nano 0.1.13 Planner→Navigator→DOM 序号链 |
| L1 控制层 | 优先可接 CDP / Playwright / accessibility snapshot 的活跃栈 |
| L0 读网/技能 | Firecrawl、BrowserAct skill、web-access 等仅作补充，不作主核 |

## 放弃的策略

- 把“继续在 Nano Core 上堆功能”当成默认路线。
- 仅靠换更强模型假装解决状态机、审批、假完成、误删与隐私问题。
- 为追 star 数改成云浏览器默认路径，放弃用户日常登录态（与 001 冲突）。
- 在未做同题 bake-off 前整仓推倒，或反过来拒绝一切结构性改动。

## 后果

- 短期：bake-off **从 P1（Stagehand/Playwright 系）起跑**，不做「只换强模型的 P0」。目标是中等模型也能过 PRD 闸门。
- 可选：P2 Browser Use 作能力上限；P3 PageAgent 作登录态范式对照。
- 中期：P1（或对照胜出方）接入 L4 契约；Nano Core 降级为可删除适配器。
- 长期：执行核可再换；产品语言与验收口径稳定在 PRD。

## 停止 / 升级条件

沿用 `product/001` 闸门。额外：

- 任一路径仍出现 **未批准外部提交** 或 **假完成**：禁止扩大自动提交。
- 在原版 Core 上两轮根因修复后黄金旅程仍 ≤5/10：**停止堆功能，启动换核**。
- 换核路径若无法挂主 Chrome 登录态：只能作对照，不能作默认产品路径。

## 参考

- Bake-off 协议：`docs/product/002-agent-core-bakeoff.md`
- 调研备忘：`reports/nanobrowser/2026-07-15-agent-core-landscape.md`
- PRD：`docs/product/001-nanobrowser-prd.md`
