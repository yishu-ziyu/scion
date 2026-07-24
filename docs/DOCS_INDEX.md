# Documentation Index

> Prefer hand-maintained rows when ship generator is absent. Entry: [docs/README.md](docs/README.md).  
> Engineering hygiene (not numbered): [ENGINEERING.md](../ENGINEERING.md).

| Category | # | Status | Name | Description | Last Modified | Path |
|----------|---|--------|------|-------------|---------------|------|
| product | 015 | current | 贾维斯验收句（冻结） | 关页×2、播/停、「这个」续控、抓取、下载；verified_pass + drm_blocked/stream_not_found。 | 2026-07-23 | [015](docs/product/015-jarvis-acceptance-sentences.md) |
| product | 013 | current | 质量优先 TSR Bake-off（出身归零） | 18 条固定任务；A0/A1/A2/A3 对打；TSR 决定换核；Nanobrowser 血统不计分。 | 2026-07-23 | [013](docs/product/013-quality-first-tsr-bakeoff.md) |
| product | 012 | current | Phase 1 执行计划与人机闸门 | 持续推进切片；仅 H1–H4 请 Owner 真机体验。 | 2026-07-23 | [012](docs/product/012-phase1-execution-plan.md) |
| product | 017 | current | Claw 对标目标与验收门 | when I do X → I see Y；G-M0…G-M80 开发顺序。 | 2026-07-23 | [017](docs/product/017-claw-parity-goals-and-acceptance.md) |
| product | 016 | current | Sider Claw 30 例 → 持节验收矩阵 | R/T/G/O 故事映射里程碑 M0–M80；与 015/013 分工。 | 2026-07-23 | [016](docs/product/016-sider-claw-parity-matrix.md) |
| product | 014 | current | 可执行框架公理（指哪打哪） | 六层 harness + 产品人话公理；展示层反泄漏硬禁止；A→C。 | 2026-07-23 | [014](docs/product/014-executable-framework-axioms.md) |
| design | 006 | current | 持节侧栏 Feature-First 流程 | Goal → Flow → UI 节点 → Atomic；映射现有 chijie 组件；服务 Claw 30 门，个性化后置。 | 2026-07-23 | [006](docs/design/006-feature-first-sidepanel-flows.md) |
| design | 005 | current | 持节任务 UX 原则（对标 Claw） | 页内操作条、人话步骤、成果链接、停止与连续控制；反泄漏。 | 2026-07-23 | [005](docs/design/005-chijie-task-ux-from-claw.md) |
| product-research | sider-claw/016 | draft | Sider Claw 30 例目录 + UX | 落地页 30 演示；Amazon 帧级交互；持节 80% 复刻含义。 | 2026-07-23 | [016](docs/product/research/sider-claw/016-sider-claw-demo-catalog-and-ux.md) |
| product | 011 | current | 先对标再差异：Browser Agent Parity 优先 | Phase 1 只做可靠浏览器操作；TSR 主指标；三核；记忆只预留接口。 | 2026-07-23 | [011](docs/product/011-browser-agent-parity-first.md) |
| product | 010 | current | 三层 Loop × G1–G4 × cmux 协议 | Ng 三层环 + Matt 工程法 + 四窗人格；复杂任务先封 L1。 | 2026-07-16 | [010](docs/product/010-three-loop-g1-g4-protocol.md) |
| product | 009 | current | Tabbit 差距台账与缩差顺序 | 插件为最终形态；对标 Tabbit 的能力与体验，持续记录差距、顺序与证据。 | 2026-07-15 | [009](docs/product/009-tabbit-gap-ledger.md) |
| design | 004 | current | 持节安静任务控制台（侧栏三态视觉与动效） | 浅色任务优先侧栏；运行中、等待批准、已验证三态；动效、数据契约与可视验收。 | 2026-07-15 | [004](docs/design/004-chijie-calm-task-console.md) |
| product | 008 | current | Tabbit 级 Agent 任务环规格（持节 MVP） | 任务模式 + 页真动 + 人话步骤 + 证据完成；索引指向 `.ship/.../SPEC.md`；tickets 01–05 已落地，前沿 06/07。 | 2026-07-15 | [008](docs/product/008-tabbit-class-agent-task-loop-spec.md) |
| product | 007 | current | 从 pi-computer-use 可借鉴什么（持节） | 持节借状态机/后置条件/三态结果；不集成整仓；可转发对齐。 | 2026-07-15 | [007](docs/product/007-pi-computer-use-borrow-for-chijie.md) |
| product | 006 | draft | 外环 RL 最小方案（可选后续） | 只写方案、暂不执行。可验证闸门 rollout + Skill；不训权重。目录预留 reports/nanobrowser/outer-rl/。 | 2026-07-15 | [006](docs/product/006-outer-loop-rl-min-plan.md) |
| decisions | 003 | current | 能力天花板 A→C、双声口与私有化复利 | 现在 A 走路；方向 C；工程可极致、产品不轴；私有插件越来越懂用户。 | 2026-07-23 | [003](docs/decisions/003-a-to-c-capability-ceiling-and-voice.md) |
| decisions | 002 | current | 质量优先，Agent Core 可替换 | 质量高于沉没成本；保留 Chrome 扩展产品层，允许替换 NanoBrowser 原版 Agent 执行核。 | 2026-07-15 | [002](docs/decisions/002-quality-first-replaceable-agent-core.md) |
| decisions | 001 | current | 保留 Chrome 扩展作为浏览器行动载体 | 插件是最终产品形态；对标 Tabbit 能力与体验，不新造浏览器。 | 2026-07-15 | [001](docs/decisions/001-keep-chrome-extension.md) |
| design | 003 | draft | 持节 v1 交互设计（侧栏 + 设置） | ChatGPT 交互稿归档；侧栏六块/设置七块与 Task 契约对照。 | 2026-07-15 | [003](docs/design/003-chijie-ui-interaction.md) |
| design | 002 | current | 生产换核：可替换 ExecutorDriver 与 P1 控制环 | M2/G6：control 默认核 + nano 可拔；LLM control + 脚本测。 | 2026-07-15 | [002](docs/design/002-production-core-swap.md) |
| product | 005 | draft | 黄金旅程固定协议（飞书 / B 站） | M3 G3/G4 可复现协议；需 Owner 登录态执行。 | 2026-07-15 | [005](docs/product/005-golden-journeys-protocol.md) |
| design | 001 | partially-outdated | 浏览器行动任务运行时 | L4 Task 壳已落地；默认执行核与换核细节见 design/002。 | 2026-07-15 | [001](docs/design/001-browser-action-task-runtime.md) |
| product | 004 | current | 文档驱动开发规范 | 用 product/decision/design 闸门驱动实现顺序与验收；禁止无编号顺手开发。 | 2026-07-15 | [004](docs/product/004-docs-driven-dev.md) |
| product | 003 | current | 浏览器行动 Agent 北极星（唯一最终目标） | 效果对齐美团 Tabbit 披露准确率（Agent≈91.8% / 网页操作≥70%）；可验证委托；中等模型；可换核。 | 2026-07-15 | [003](docs/product/003-north-star.md) |
| product | 002 | draft | Agent Core Bake-off 协议 | 以 Stagehand/Playwright 系（P1）为主；可选 Browser Use 上限。中等模型过 PRD 闸门。 | 2026-07-15 | [002](docs/product/002-agent-core-bakeoff.md) |
| product | 001 | draft | Nanobrowser 二开：可验证浏览器行动 Agent PRD | 定义单任务连续控制、可验证完成、动作审批与本地 Skill 复用；发布闸门对齐 Tabbit 91.8%/70%。 | 2026-07-15 | [001](docs/product/001-nanobrowser-prd.md) |
