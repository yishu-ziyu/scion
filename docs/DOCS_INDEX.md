# Documentation Index

> Prefer hand-maintained rows when ship generator is absent. Entry: [docs/README.md](docs/README.md).

| Category | # | Status | Name | Description | Last Modified | Path |
|----------|---|--------|------|-------------|---------------|------|
| decisions | 002 | current | 质量优先，Agent Core 可替换 | 质量高于沉没成本；保留 Chrome 扩展产品层，允许替换 NanoBrowser 原版 Agent 执行核。 | 2026-07-15 | [002](docs/decisions/002-quality-first-replaceable-agent-core.md) |
| decisions | 001 | current | 保留 Chrome 扩展作为浏览器行动载体 | 记录为何本轮在现有扩展内建设任务运行时，而不是新造浏览器或云端执行器。 | 2026-07-13 | [001](docs/decisions/001-keep-chrome-extension.md) |
| design | 002 | not-implemented | 生产换核：可替换 ExecutorDriver 与 P1 控制环 | M2：在 Task/审批/回执壳下接入 P1 级控制环；Nano 可拔；媒体走元素 API。 | 2026-07-15 | [002](docs/design/002-production-core-swap.md) |
| design | 001 | partially-outdated | 浏览器行动任务运行时 | L4 Task 壳已落地；默认执行核与换核细节见 design/002。 | 2026-07-15 | [001](docs/design/001-browser-action-task-runtime.md) |
| product | 004 | current | 文档驱动开发规范 | 用 product/decision/design 闸门驱动实现顺序与验收；禁止无编号顺手开发。 | 2026-07-15 | [004](docs/product/004-docs-driven-dev.md) |
| product | 003 | current | 浏览器行动 Agent 北极星（唯一最终目标） | 效果对齐美团 Tabbit 披露准确率（Agent≈91.8% / 网页操作≥70%）；可验证委托；中等模型；可换核。 | 2026-07-15 | [003](docs/product/003-north-star.md) |
| product | 002 | draft | Agent Core Bake-off 协议 | 以 Stagehand/Playwright 系（P1）为主；可选 Browser Use 上限。中等模型过 PRD 闸门。 | 2026-07-15 | [002](docs/product/002-agent-core-bakeoff.md) |
| product | 001 | draft | Nanobrowser 二开：可验证浏览器行动 Agent PRD | 定义单任务连续控制、可验证完成、动作审批与本地 Skill 复用；发布闸门对齐 Tabbit 91.8%/70%。 | 2026-07-15 | [001](docs/product/001-nanobrowser-prd.md) |
