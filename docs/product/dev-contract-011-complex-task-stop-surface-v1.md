---
title: "dev-contract-011 complex task stop surface v1"
status: frozen
version: v1
owner: G1
spec_author: G2
implementer: G3
verifier: G4
created: "2026-07-16"
depends_on: "docs/product/dev-contract-010-l1-no-progress-v1.md"
---

# Contract 011-v1 — 复杂任务停机表面：失败类 / 等人可见

## 问题（G1）

用户在**侧栏**委托多步复杂任务时，持节一旦因无进展或步数耗尽而停机，侧栏任务状态必须立刻显示**产品失败类**（或**等人**），而不是无限转圈 / 永远 `running`。

010 已封 L1：`runObserveActLoop` 可返回 `no_progress` / `max_steps`。
011 只封 **control 路径 → 任务状态 → 侧栏表面** 这一刀：停机结果必须冒泡成用户可读的停机态。

## 非目标

- 不改飞书真站批准旅程（票 **06**）与其验收
- 不改 UI 设计体系、不换品牌文案体系（沿用现有 i18n + `failure-taxonomy`）
- 不引入外环 RL、不改 maxSteps 默认策略
- 不动 **W\*** 协作窗；不扩 scope 到票 07 媒体绑定
- 不重做 010 的 L1 无进展检测逻辑（只消费其失败类）

## 范围（唯一竖切）

**路径：** control backend（默认 `control`）→ `ExecutorOutcome` → `TaskManager` 任务快照 → 侧栏 `TaskStatusCard` / `failure-taxonomy`。

必须成立：

1. control 路径在 loop 以 `failed` 结束且 `category` 为 **`no_progress`** 或 **`max_steps`** 时，任务快照：
   - `status === 'failed'`
   - 当前 round 的 **`failureCategory`** 原样保留该字符串（`no_progress` | `max_steps`）
2. 侧栏对上述 `failureCategory` 经 `pages/side-panel/src/presentation/failure-taxonomy.ts` 映射为产品码：
   - `toProductFailureCode('no_progress') === 'model_loop'`
   - `toProductFailureCode('max_steps') === 'model_loop'`
3. 失败任务卡**必须**展示产品失败标签（`productFailureLabel` / 等价可见文案），**禁止**仅靠聊天里工程师噪声表示停机；**禁止**停机后仍呈现进行中转圈且无失败类。
4. control 路径若以 `waiting_user` 结束（如 `login_required` / `captcha_required`），快照 `status === 'waiting_user'`，侧栏呈现等人态（非失败、非无限 running）。
5. 允许改动的文件范围（G3 最小集，按需）：
   - `chrome-extension/.../backends/control-llm.ts`（及同类 control 入口）
   - `chrome-extension/.../task/manager.ts`（若冒泡缺口在此）
   - `pages/side-panel/src/presentation/failure-taxonomy.ts` + `TaskStatusCard.tsx`（仅当映射或展示缺口）
   - 对应 `__tests__` 单测

## 产品失败类对照（冻结）

| 执行器 category | 产品码 (`ProductFailureCode`) | 侧栏期望 |
|-----------------|-------------------------------|----------|
| `no_progress` | `model_loop` | failed + 产品失败标签可见 |
| `max_steps` | `model_loop` | failed + 产品失败标签可见 |
| `waiting_user`（outcome.kind，非 category） | 不走 failed 映射 | `waiting_user` + 等人提示 |

权威实现对照：`projects/chijie-browser/pages/side-panel/src/presentation/failure-taxonomy.ts`。

## Evals（G4 必须跑；至少 2 条）

| ID | 当… | 应… | 测缝 |
|----|-----|-----|------|
| **E1** | 调用 `toProductFailureCode('no_progress')` 与 `toProductFailureCode('max_steps')` | 均为 `'model_loop'`；`productFailureLabel` 非空且不含工程师噪声 token | `pages/side-panel/.../failure-taxonomy.test.ts` |
| **E2** | TaskManager 在 driver `run` resolve `{ kind: 'failed', category: 'no_progress' }`（及 `max_steps`） | 快照 `status === 'failed'` 且 `rounds[0].failureCategory` 分别为 `no_progress` / `max_steps` | `chrome-extension/.../task/__tests__/manager.test.ts` |
| **E3**（回归，建议） | 既有 failureCategory 展示与 taxonomy 绿测 | 全过，无回归 | 同包既有测 |

命令（在 `projects/chijie-browser` 根，退出码 0 为 PASS 必要条件）：

```bash
pnpm -F @extension/sidepanel test -- src/presentation/__tests__/failure-taxonomy.test.ts
pnpm -F chrome-extension test -- src/background/task/__tests__/manager.test.ts
```

若包名 filter 与仓库不一致，G3 在回传中写明实际 filter；G4 以**可复现命令 + exit 0**为准。

**E1+E2 为门禁；E3 不红。** 不要求本刀飞书真站或人工点侧栏截图（那是 L3 / 其他 contract）。

## 完成定义

- [ ] G3：control 冒泡缺口若存在则补齐；E1/E2 单测覆盖（可扩既有测，勿空转）
- [ ] G4：上表命令 exit 0 + 本文件 checklist 勾完
- [ ] G1：010 协议 Progress log 写一行（011 竖切）

## 回传格式

**G3：** 改动文件列表；测试命令；exit code；未做项  
**G4：** PASS/FAIL；证据（命令输出摘要路径或粘贴末 20 行）；失败类若有

## 验收项列表（给 G3/G4 对照）

1. control 停机 `no_progress` → 任务 `failed` + `failureCategory=no_progress`（非永久 running）
2. control 停机 `max_steps` → 任务 `failed` + `failureCategory=max_steps`
3. 上述两类在侧栏 taxonomy 映射为产品码 `model_loop` 并有可见产品标签
4. control `waiting_user` → 任务 `waiting_user`（等人，非转圈无说明）
5. 不触 06 飞书、不触 W\*、不扩 07
6. E1 + E2 命令可复现且 exit 0
