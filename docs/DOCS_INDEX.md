# Documentation Index

> Prefer hand-maintained rows when ship generator is absent. Entry: [docs/README.md](./README.md).
> Engineering hygiene (not numbered): [ENGINEERING.md](../ENGINEERING.md).
> **Truth chain:** 021 → decision 004 → 020 → 019 → run_state. Historical docs never override.

| Category | # | Status | Name | Description | Last Modified | Path |
|----------|---|--------|------|-------------|---------------|------|
| product | 022 | proposed | Adaptive Browser Harness v1 | product proposed；Kernel/Skill/Artifact default_enabled；Diff/Learned 关；见 §0 状态表。 | 2026-08-11 | [022](docs/product/022-adaptive-browser-harness-v1.md) |
| decisions | 004 | current | 任务内自主执行，不用强制审批打断用户 | 用户给出任务即是授权；外部提交不再作为默认阻塞点。 | 2026-08-02 | [004](docs/decisions/004-task-scoped-autonomy.md) |
| product | 021 | current | 长程任务 Agent 北极星 | 一次委托、计划、长上下文、自主执行、可验证交付；取代旧浏览器操作演示叙事。 | 2026-08-11 | [021](docs/product/021-long-horizon-task-agent.md) |
| design | 007 | current | ego-lite 启发：Snapshot Frame | index 只在当前观察帧有效；driver 自动绑定 revision；页面漂移先拒绝再观察。 | 2026-07-30 | [007](docs/design/007-ego-lite-snapshot-frame.md) |
| product | 020 | current | 持节评估主表与运行协议 | 013/015/016/017/018/021-LH 统一 task_id、矩阵列、运行顺序与验收纪律。 | 2026-08-06 | [020](docs/product/020-eval-master.md) |
| product | 019 | current | AI Agent Book 驱动的持节建设规划 | Harness / Eval / Observability / Outer Loop 建设路线；服务 021，不是旧 M3 北极星。 | 2026-08-11 | [019](docs/product/019-ai-agent-book-build-plan.md) |
| product | 015 | historical | 贾维斯验收句（冻结） | 旧方向历史验收句，已被 product/021 取代。 | 2026-07-23 | [015](docs/product/015-jarvis-acceptance-sentences.md) |
| product | 013 | historical | 质量优先 TSR Bake-off（出身归零） | 旧方向历史评估任务集。 | 2026-07-23 | [013](docs/product/013-quality-first-tsr-bakeoff.md) |
| product | 012 | historical | Phase 1 执行计划与人机闸门 | 旧 Parity 阶段计划；已被 021 + run_state long_horizon_v1 取代。 | 2026-08-11 | [012](docs/product/012-phase1-execution-plan.md) |
| product | 018 | historical | Claw 30 例真机记分板 | 历史评测资产/参考集；非当前北极星（见 021）。 | 2026-08-11 | [018](docs/product/018-claw-30-live-scorecard.md) |
| product | 017 | historical | Claw 对标目标与验收门 | 旧方向历史验收门。 | 2026-07-23 | [017](docs/product/017-claw-parity-goals-and-acceptance.md) |
| product | 016 | historical | Sider Claw 30 例 → 持节验收矩阵 | 旧方向历史验收矩阵。 | 2026-07-23 | [016](docs/product/016-sider-claw-parity-matrix.md) |
| product | 014 | historical | 可执行框架公理（指哪打哪） | 旧方向历史公理，审批相关内容已失效。 | 2026-07-23 | [014](docs/product/014-executable-framework-axioms.md) |
| design | 006 | historical | 持节侧栏 Feature-First 流程 | 旧方向历史文档，已被 product/021 + decisions/004 取代。 | 2026-07-23 | [006](docs/design/006-feature-first-sidepanel-flows.md) |
| design | 005 | historical | 持节任务 UX 原则（对标 Claw） | 旧方向历史文档，已被 product/021 取代。 | 2026-07-23 | [005](docs/design/005-chijie-task-ux-from-claw.md) |
| product-research | sider-claw/016 | draft | Sider Claw 30 例目录 + UX | 落地页 30 演示；Amazon 帧级交互；持节 80% 复刻含义。 | 2026-07-23 | [016](docs/product/research/sider-claw/016-sider-claw-demo-catalog-and-ux.md) |
| product | 011 | historical | 先对标再差异：Browser Agent Parity 优先 | 旧方向历史文档，已被 product/021 取代。 | 2026-07-23 | [011](docs/product/011-browser-agent-parity-first.md) |
| product | 010 | current | 三层 Loop × G1–G4 × cmux 协议 | Ng 三层环 + Matt 工程法 + 四窗人格；复杂任务先封 L1。 | 2026-07-16 | [010](docs/product/010-three-loop-g1-g4-protocol.md) |
| product | 009 | historical | Tabbit 差距台账与缩差顺序 | 旧方向历史差距台账。 | 2026-07-15 | [009](docs/product/009-tabbit-gap-ledger.md) |
| design | 004 | historical | 持节安静任务控制台（侧栏三态视觉与动效） | 旧方向历史文档，审批态已删除。 | 2026-07-15 | [004](docs/design/004-chijie-calm-task-console.md) |
| product | 007 | historical | 从 pi-computer-use 可借鉴什么（持节） | 旧方向历史借鉴文档，审批相关内容已失效。 | 2026-07-15 | [007](docs/product/007-pi-computer-use-borrow-for-chijie.md) |
| product | 006 | current | 外环 RL 最小方案 | Wave 5 进行中：runner 已跑；Skill candidates 已落盘；不训权重。 | 2026-08-11 | [006](docs/product/006-outer-loop-rl-min-plan.md) |
| decisions | 003 | current | 能力天花板 A→C、双声口与私有化复利 | 现在 A 走路；方向 C；工程可极致、产品不轴；私有插件越来越懂用户。 | 2026-07-23 | [003](docs/decisions/003-a-to-c-capability-ceiling-and-voice.md) |
| decisions | 002 | current | 质量优先，Agent Core 可替换 | 质量高于沉没成本；保留 Chrome 扩展产品层，允许替换 NanoBrowser 原版 Agent 执行核。 | 2026-07-15 | [002](docs/decisions/002-quality-first-replaceable-agent-core.md) |
| decisions | 001 | current | 保留 Chrome 扩展作为浏览器行动载体 | 插件是最终产品形态；对标 Tabbit 能力与体验，不新造浏览器。 | 2026-07-15 | [001](docs/decisions/001-keep-chrome-extension.md) |
| design | 003 | historical | 持节 v1 交互设计（侧栏 + 设置） | 旧方向历史交互稿归档，审批卡已删除。 | 2026-07-15 | [003](docs/design/003-chijie-ui-interaction.md) |
| design | 002 | current | 生产换核：可替换 ExecutorDriver 与 P1 控制环 | M2/G6：control 默认核 + nano 可拔；LLM control + 脚本测。 | 2026-07-15 | [002](docs/design/002-production-core-swap.md) |
| product | 005 | historical | 黄金旅程固定协议（飞书 / B 站） | 旧方向历史协议，审批门已删除。 | 2026-07-15 | [005](docs/product/005-golden-journeys-protocol.md) |
| design | 001 | historical | 浏览器行动任务运行时 | 旧方向历史运行时文档；当前以 product/021 + design/002 为准。 | 2026-07-15 | [001](docs/design/001-browser-action-task-runtime.md) |
| product | 004 | current | 文档驱动开发规范 | 用 product/decision/design 闸门驱动实现顺序与验收；禁止无编号顺手开发。 | 2026-07-15 | [004](docs/product/004-docs-driven-dev.md) |
| product | 003 | historical | 浏览器行动 Agent 北极星（唯一最终目标） | 旧方向历史文档，已被 product/021 取代。 | 2026-07-15 | [003](docs/product/003-north-star.md) |
| product | 002 | draft | Agent Core Bake-off 协议 | 以 Stagehand/Playwright 系（P1）为主；可选 Browser Use 上限。中等模型过 PRD 闸门。 | 2026-07-15 | [002](docs/product/002-agent-core-bakeoff.md) |
| product | 001 | historical | Nanobrowser 二开：可验证浏览器行动 Agent PRD | 旧方向历史 PRD，动作审批已删除。 | 2026-07-15 | [001](docs/product/001-nanobrowser-prd.md) |
