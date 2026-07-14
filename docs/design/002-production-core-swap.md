---
title: "生产换核：可替换 ExecutorDriver 与 P1 控制环"
description: "M2：在 Task/审批/回执壳下接入 P1 级控制环；Nano Planner 环降为可拔适配器；媒体走元素 API。"
category: "design"
number: "002"
status: current
services: ["projects/yishu-browser/chrome-extension/src/background"]
related: ["design/001", "decisions/001", "decisions/002", "product/002", "product/003", "product/004"]
last_modified: "2026-07-15"
---

# 002 — 生产换核：可替换 ExecutorDriver 与 P1 控制环

## Status

**current（M2 / G6 接缝已上线）。**

- M1：P1 harness MiniMax-M3 **G1/G2 = 10/10**（`reports/nanobrowser/bakeoff/2026-07-14-m1-matrix.csv`）。
- **已落地：**
  - `agent/backends/types.ts` — `nano` | `control`；默认 **`control`**
  - `agent/backends/nano.ts` — Planner/Navigator（可拔）
  - `agent/backends/control-loop.ts` — 脚本化 control
  - `agent/backends/control-llm.ts` + `control-policy.ts` — 生产 LLM control（MiniMax JSON 硬化）
  - `agent/factory.ts` — 多后端；无脚本时走 LLM control
  - 单测：backends + control journey（批前 0 / 批后 1 / 回执）
- **残余：** 扩展内真实页 e2e 仍依赖 Owner 加载 unpacked；真实站 G3/G4 属 M3。

## Summary

生产路径只认 **L4 契约**（TaskManager / ActionDispatcher / CompletionChecker / 回执）。
执行核通过窄接口 `ExecutorDriver` 可插拔。
M2 引入 **control** 后端：把 P1 验证过的「中等模型 + 观察/动作控制环 + 审批外置 + 媒体元素 API」迁入扩展内 BrowserContext；**nano** 后端保留但默认可关。
不在扩展 service worker 内嵌 Node Stagehand 进程；不默认上云浏览器。

## Decision (lead)

| 选择 | 内容 |
|---|---|
| 权威层 | TaskManager 拥有任务生命周期；核不得直写 `completed` |
| 接缝 | 唯一 `createExecutor(input, hooks) → ExecutorDriver`（`task/contracts.ts`） |
| 默认生产核（M2 目标） | `control`：单环 observe→act 风格，经 `hooks.dispatchAction` 出副作用 |
| 可拔核 | `nano`：现有 Planner/Navigator；配置可切回，非终局 |
| 页面控制 | 扩展内 `BrowserContext` / Page（用户日常 Chrome 登录态） |
| 媒体 | `control_media` 经 **元素 API**（`HTMLMediaElement.play/pause`），禁止依赖 shadow 控件点击 |
| 外部提交 | 仅 ActionDispatcher + EffectPolicy；核不得绕过 |
| 正式模型 | MiniMax-M3（或同级）；与 G5 一致 |

## Why not embed Stagehand in the extension

P1 harness 用 Stagehand LOCAL（Node + Playwright 自启浏览器）证明了控制层质量。
生产必须挂 **用户日常 Chrome 登录态**（`decisions/001`），而：

1. MV3 service worker **没有 Node / Playwright 进程**；
2. 自启浏览器 **没有** 用户 Cookie / 登录态；
3. 远程调试附着可选，但会破坏「Load unpacked 扩展即可用」的默认路径。

因此 M2 **吸收 P1 的控制契约与媒体策略**，在扩展内实现等价控制环；Stagehand 进程继续作 harness / 可选 companion，**不是**默认产品路径。

## Architecture

```text
SidePanel
  → TaskManager (L4)
       → createExecutorFactory(kind)
            ├─ nano     → Executor (Planner/Navigator)  [demotable]
            └─ control  → ControlLoopDriver            [M2 target]
       → ActionDispatcher → EffectPolicy → ActionBuilder / Page
       → CompletionChecker → receipt
```

### ExecutorDriver contract (unchanged surface)

```ts
interface ExecutorDriver {
  run(roundId: string): Promise<ExecutorOutcome>;
  addFollowUp(instruction: string): void;
  pause(): void;
  resume(): void;
  stop(): Promise<void>;
}

interface ExecutorHooks {
  onPlan(roundId: string, criteria: CompletionCriterionDraft[]): Promise<void>;
  dispatchAction(roundId: string, action: Action, rawArgs: unknown): Promise<DispatchResult>;
}
```

核只允许：

- 读页面观察（经 BrowserContext / Page）；
- 调模型生成下一步与候选完成条件；
- 通过 `hooks.dispatchAction` 执行动作；
- 通过 `hooks.onPlan` 申报完成条件草稿。

核禁止：

- 直接 `Action.call()`；
- 在无审批路径提交表单 / 发送 / 购买；
- 把模型 `done` 写成任务 `completed`；
- 持久化表单值、凭证、完整页面正文。

### control 后端行为

1. **附着** `input.tabId` 上的已有标签（不新开无登录态浏览器）。
2. **规划一次**：模型输出目标摘要 + `CompletionCriterionDraft[]` → `onPlan`。
3. **循环**（上限 `maxSteps`）：
   - 观察：可交互元素摘要 + 媒体候选状态（digest）；
   - 模型选一个标准动作（与现有 Action schema 对齐：`input_text` / `click_element` / `control_media` / `done` …）；
   - `dispatchAction`；若返回 waiting_approval，驱动进入 pause 语义，等 TaskManager 的 approve 后再 `resume` 单次已批动作（现有 Dispatcher 路径）；
   - 若 `done` 或模型宣称完成 → `candidate_complete`；由 CompletionChecker 裁决。
4. **JSON 硬化**：剥离 `<think>` / 围栏；从混杂文本提取 JSON（P1 MiniMax 经验）。
5. **媒体**：优先 `control_media`；Page 层用 fingerprint + 元素 API，失败不得 fallback 到 shadow DOM 点击当成功。

### nano 后端

现有 `createExecutorDriver` 逻辑迁入 `agent/backends/nano.ts`（或保留 factory 内部分支）。
行为不变；文档与设置标明 **legacy / demotable**。

### 配置

| 键 | 值 | 说明 |
|---|---|---|
| `agentCore.backend` | `control` \| `nano` | 默认 M2 合并后改为 `control`；未稳前可先 `nano` + 显式切 `control` |
| 模型 | 现有 agentModelStore / MiniMax provider | 正式分必须中等模型 |

存储位置：与 general settings 同级或 `personal/config` 开发默认；不把密钥写入文档。

## Boundaries

### In scope (M2)

- 多后端工厂与 `ExecutorDriver` 注册。
- `control` 最小可运行：fixture 级表单填+批+提交、媒体 play/pause 经元素 API，仍走 TaskManager。
- 单元 / journey 测试覆盖接缝切换与 media digest 绑定。
- G1/G2：**P1 harness 矩阵仍为 M1 证据**；生产路径增加可重复的扩展内 journey 或 e2e，不得低于既有假驱动 journey 质量。
- 更新 `design/001` 中「仅现有 Executor 适配器」表述为「多后端」。

### Out of scope (M2)

- G3/G4 飞书 / B 站 91.8%（M3）。
- Native Messaging + 外挂 Stagehand companion（可记为 M2.5 备选，不阻塞 G6 宣称「可换核」）。
- 删除 Nano 源码（只降级，不在本里程碑硬删）。
- Skill 市场、并行任务、云浏览器默认路径。

### Must not

- 绕过 ActionDispatcher 的执行路径。
- 默认路径依赖「新 Playwright 浏览器」。
- 用旗舰模型刷生产分。
- 媒体成功判定依赖点击原生 shadow 控件。

## Module map (target paths)

| 模块 | 路径 |
|---|---|
| 契约 | `chrome-extension/src/background/task/contracts.ts` |
| 工厂 | `chrome-extension/src/background/agent/factory.ts` |
| Nano 后端 | `chrome-extension/src/background/agent/backends/nano.ts` |
| Control 后端 | `chrome-extension/src/background/agent/backends/control-loop.ts` |
| JSON 硬化 | `chrome-extension/src/background/agent/json-extract.ts`（已有则复用） |
| 媒体 | `chrome-extension/src/background/browser/page.ts` `controlMedia` / `observeMedia` |
| 接线 | `chrome-extension/src/background/index.ts` |

## Acceptance (M2 done = G6 claimable)

| # | 条件 |
|---|---|
| A1 | 设置可在 `nano` / `control` 间切换；默认策略写在文档与代码注释一致 |
| A2 | `control` 路径下 TaskManager form-journey（假或真模型）仍满足：批前 0 提交、批后 1、0 假完成 |
| A3 | `control` 路径下 media：play→pause 同 digest；实现走元素 API |
| A4 | 生产代码无第二套「Planner 直写 completed」旁路 |
| A5 | `design/002` → `current`；`003` / `run_state` 记录 M2 complete 与证据路径 |
| A6 | G1/G2 回归：P1 `run-matrix` 或等价报告仍绿（或说明仅生产 journey 回归且数字在 reports/） |

## Trade-offs

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 扩展内 control 环 | 登录态、审批壳一体、可维护 | 需自建 act/observe 提示与解析 | **M2 默认** |
| 外挂 Stagehand + CDP | 复用 P1 库 | 安装/端口/安全面复杂 | 备选 |
| 继续只修 Nano | 改动小 | 与 decisions/002、M1 证据方向相反 | 拒绝作默认 |

## Assumptions

1. 用户 Chrome 可通过扩展 API 附着标签并 evaluate（现有 BrowserContext 成立）。
2. MiniMax OpenAI 兼容接口稳定；JSON 仍需硬化。
3. Action schema 集合足够表达 fixture 表单与媒体；真实站增量动作在 M3 再扩。
4. G6「可换核」定义为：生产可运行非 Nano 后端，且 L4 契约不变 — 不要求删除 Nano。

## Implementation slices (order)

1. **Docs**：本文 + `design/001` 接缝表述 + README 里程碑（本切片）。
2. **Seam**：factory 分 backend；nano 抽出；设置键。
3. **Control skeleton**：固定步数假模型 / 脚本化 fixture 驱动可过 journey 测试。
4. **Control + MiniMax**：真实中等模型；JSON 硬化。
5. **Media API  hardening**：失败分类与 target digest 回归测试。
6. **证据**：`reports/nanobrowser/m2-*.md` + 更新 run_state。

## References

- `docs/product/003-north-star.md` — M2 / G6
- `docs/product/002-agent-core-bakeoff.md` — P1 协议
- `docs/decisions/002-quality-first-replaceable-agent-core.md`
- `docs/design/001-browser-action-task-runtime.md` — L4 运行时
- M1 证据：`reports/nanobrowser/bakeoff/2026-07-14-m1-matrix.csv`
