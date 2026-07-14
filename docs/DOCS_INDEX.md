# Documentation Index

> Prefer hand-maintained rows when ship generator is absent. Entry: [docs/README.md](docs/README.md).

| Category | # | Status | Name | Description | Last Modified | Path |
|----------|---|--------|------|-------------|---------------|------|
| product | 006 | draft | 外环 RL 最小方案（可选后续） | 只写方案、暂不执行。可验证闸门 rollout + Skill；不训权重。目录预留 reports/nanobrowser/outer-rl/。 | 2026-07-15 | [006](docs/product/006-outer-loop-rl-min-plan.md) |
| decisions | 002 | current | 质量优先，Agent Core 可替换 | 质量高于沉没成本；保留 Chrome 扩展产品层，允许替换 NanoBrowser 原版 Agent 执行核。 | 2026-07-15 | [002](docs/decisions/002-quality-first-replaceable-agent-core.md) |
| decisions | 001 | current | 保留 Chrome 扩展作为浏览器行动载体 | 记录为何本轮在现有扩展内建设任务运行时，而不是新造浏览器或云端执行器。 | 2026-07-13 | [001](docs/decisions/001-keep-chrome-extension.md) |
| design | 003 | draft | 持节 v1 交互设计（侧栏 + 设置） | ChatGPT 交互稿归档；侧栏六块/设置七块与 Task 契约对照。 | 2026-07-15 | [003](docs/design/003-chijie-ui-interaction.md) |
| design | 002 | current | 生产换核：可替换 ExecutorDriver 与 P1 控制环 | M2/G6：control 默认核 + nano 可拔；LLM control + 脚本测。 | 2026-07-15 | [002](docs/design/002-production-core-swap.md) |
| product | 005 | draft | 黄金旅程固定协议（飞书 / B 站） | M3 G3/G4 可复现协议；需 Owner 登录态执行。 | 2026-07-15 | [005](docs/product/005-golden-journeys-protocol.md) |
| design | 001 | partially-outdated | 浏览器行动任务运行时 | L4 Task 壳已落地；默认执行核与换核细节见 design/002。 | 2026-07-15 | [001](docs/design/001-browser-action-task-runtime.md) |
| product | 004 | current | 文档驱动开发规范 | 用 product/decision/design 闸门驱动实现顺序与验收；禁止无编号顺手开发。 | 2026-07-15 | [004](docs/product/004-docs-driven-dev.md) |
| product | 003 | current | 浏览器行动 Agent 北极星（唯一最终目标） | 效果对齐美团 Tabbit 披露准确率（Agent≈91.8% / 网页操作≥70%）；可验证委托；中等模型；可换核。 | 2026-07-15 | [003](docs/product/003-north-star.md) |
| product | 002 | draft | Agent Core Bake-off 协议 | 以 Stagehand/Playwright 系（P1）为主；可选 Browser Use 上限。中等模型过 PRD 闸门。 | 2026-07-15 | [002](docs/product/002-agent-core-bakeoff.md) |
| product | 001 | draft | Nanobrowser 二开：可验证浏览器行动 Agent PRD | 定义单任务连续控制、可验证完成、动作审批与本地 Skill 复用；发布闸门对齐 Tabbit 91.8%/70%。 | 2026-07-15 | [001](docs/product/001-nanobrowser-prd.md) |
