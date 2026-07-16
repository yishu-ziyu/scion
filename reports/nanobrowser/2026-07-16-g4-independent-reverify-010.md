# G4 独立复验 — contract 010-v1 L1 no_progress

**Role:** G4 · 证伪 Prove（surface:64，ring=L1-prove）  
**Date:** 2026-07-16  
**Project:** `/Users/mahaoxuan/Desktop/AI产品经理/自研产品/scion`  
**Contract:** `docs/product/dev-contract-010-l1-no-progress-v1.md`  
**Prior G1-proxy G4 note:** `reports/nanobrowser/2026-07-16-contract-010-l1-no-progress-g4.md`

## Verdict

**PASS**

本窗独立复跑，未改任何实现文件。

## 1) 命令

```bash
cd projects/chijie-browser
pnpm -F chrome-extension test -- src/background/agent/backends/__tests__/observe-act-loop.test.ts
```

**exit code:** `0`

### 命令输出末尾（完整 vitest 尾）

```
 RUN  v2.1.9 /Users/mahaoxuan/Desktop/AI产品经理/自研产品/scion/projects/chijie-browser/chrome-extension

 ✓ src/background/agent/backends/__tests__/observe-act-loop.test.ts (10 tests) 3ms

 Test Files  1 passed (1)
      Tests  10 passed (10)
   Start at  01:16:52
   Duration  315ms (transform 28ms, setup 0ms, collect 26ms, tests 3ms, environment 0ms, prepare 68ms)
```

## 2) 源码审查：`no_progress` 逻辑是否存在

**文件:** `projects/chijie-browser/chrome-extension/src/background/agent/backends/observe-act-loop.ts`  
**结论:** **存在且与 contract 010 对齐。**

| Contract 要求 | 实现位置 / 行为 | 对照 |
|---------------|-----------------|------|
| 失败类 `no_progress` | `LoopFailureCategory` 含 `'no_progress'`（约 L18） | 有 |
| 选项 `maxNoProgress?: number`，默认 3，`<=0` 关闭 | L47–48, L71–72 | 有 |
| 连续 maxNoProgress 次成功 act 后观察文本 trim 全等 → `failed/no_progress` | reobserve 路径 L173–177；无 reobserve 时经 `pendingNoProgressBefore` 在下一 observe 比较 L102–106 | 有 |
| 观察文本变化 → 重置计数 | L108–109, L179–180 | 有 |
| act 报错不计入 no_progress | L149–153 / L162–166 清 `pendingNoProgressBefore`，不增 streak | 有 |
| `maxSteps` 耗尽仍为 `max_steps` | L195 | 有 |

## 3) Evals（对照 contract）

| ID | 要求摘要 | 单测 | 本轮 |
|----|----------|------|------|
| E1 | maxNoProgress=3，观察不变 → `no_progress`，acts=3 | `E1: fails with no_progress...` | PASS |
| E2 | reobserve 变化 → 计数清零，可 done | `E2: resets no_progress streak...` | PASS |
| E3 | maxNoProgress=0 → 可 `max_steps` | `E3: maxNoProgress=0 disables...` | PASS |
| E4 | ticket 02 既有绿测无回归 | 同文件共 10 tests 全绿 | PASS |

## 4) 是否同意 G1 代跑的结论

**同意。**

G1 代写的 `2026-07-16-contract-010-l1-no-progress-g4.md` 判 **PASS（10/10）**。  
本窗独立复跑同一命令：exit 0、**10 passed (10)**，与之一致；源码侧 `no_progress` 逻辑可核对，非空壳。

**保留说明（不改 PASS）：** 原报告注明「G2–G4 panes idle / G1 编排代跑」。本文件是 surface:64 独立复验证据，可替代「仅 G1 代跑」作为 disk truth 的 G4 证伪记录。

## 边界

- 未触碰 W\* 工作区
- 未修改实现冒充通过
- 未跑飞书真站 / 票 06（contract 非目标）

## 路径索引

| 产物 | 路径 |
|------|------|
| 本证据 | `reports/nanobrowser/2026-07-16-g4-independent-reverify-010.md` |
| Contract | `docs/product/dev-contract-010-l1-no-progress-v1.md` |
| 实现 | `projects/chijie-browser/chrome-extension/src/background/agent/backends/observe-act-loop.ts` |
| 测试 | `.../backends/__tests__/observe-act-loop.test.ts` |
