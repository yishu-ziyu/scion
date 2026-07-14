---
title: "保留 Chrome 扩展作为浏览器行动载体"
description: "记录为何本轮在现有扩展内建设任务运行时，而不是新造浏览器或云端执行器。"
category: "decisions"
number: "001"
status: current
services: ["projects/chijie-browser/chrome-extension", "projects/chijie-browser/pages/side-panel"]
related: ["design/001"]
last_modified: "2026-07-13"
---

# 001 — 保留 Chrome 扩展作为浏览器行动载体

## 状态

已决定，且与当前代码形态一致。任务运行时尚未实现，详细设计见 `design/001`。

## 决策

本轮继续使用现有 Manifest V3 Chrome 扩展，在用户日常 Chrome 登录态中建设浏览器行动能力。不会 fork Chromium，也不会把执行迁移到云端浏览器。

## 原因

- 用户要的是“完成网页动作”，不是更换默认浏览器。
- 现有 Nanobrowser 已具备侧边栏、BrowserContext、Planner/Navigator、动作注册表和本地存储。
- 真实 Chrome 保留用户已经登录的飞书、B 站等会话，避免 Cookie、密码和扩展迁移。
- OpenAI 已宣布停止独立 Atlas 浏览器，同时把浏览器 Agent 能力迁移到桌面应用和 Chrome 扩展，说明行动能力不依赖自造浏览器外壳。

## 放弃的方案

### 独立 Chromium

可以更强地控制进程生命周期、标签隔离和后台任务，但会引入浏览器安全更新、分发、数据迁移和默认浏览器切换成本。本轮没有证据证明这些成本是完成首个任务闭环的必要条件。

### 云端浏览器

可以脱离本地 Chrome 持续运行，但无法自然复用用户当前登录态，并扩大凭证、隐私和基础设施范围。

## 后果

- 首轮只保证一个活动任务。
- 侧边栏或扩展 Worker 中断时，任务进入 `interrupted`，由用户显式恢复；不承诺 Chrome 关闭后的后台执行。
- 如果真实使用证明扩展生命周期无法达到验收成功率，再重新评估 Offscreen Document、原生宿主或独立浏览器。

## 边界

- 本决策不禁止将来提供其他执行适配器，但本轮不得为了假设中的多端能力提前抽象。
- 本决策不改变现有 BYOK、MiniMax 和 URL 防火墙策略。
- 任何改为独立浏览器或云端执行的提案，都必须重新评估登录态、安全、分发和迁移成本。

## 参考

- [OpenAI：Atlas 能力迁移说明](https://help.openai.com/en/articles/20001371-evolving-atlas-into-chatgpt-for-browser-based-agentic-work)
- `.ship/tasks/plan-large-nanobrowser-second-development/product/09-tech-project-plan.md`
