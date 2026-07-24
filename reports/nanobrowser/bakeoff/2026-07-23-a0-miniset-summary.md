# A0 Mini-set Bake-off — 2026-07-23

**Arm:** A0 持节现状（Control LLM + TaskManager + B 站确定性捷径）  
**Model:** MiniMax-M3  
**Attach:** user_chrome  
**Git (workspace label):** 61a9c31（含未提交 hang-fix / first-video 改动的 dist）  
**Extension:** Owner 已 reload；自动化经 side-panel tab 发 `task_command`

## Results

| Task | Pass | n | TSR | Notes |
|------|------|---|-----|--------|
| **B01** 打开第一行第一个视频 | 2 | 3 | **0.67** | #1 `invalid_transition`（并发任务未清干净）；#2/#3 `go_to_url` → `/video/BV…` + completed |
| **A02** 是否 bilibili 首页 | 0 | 3 | **0.00** | 理解题无冻条件：`proof_required` 或 `no_completion_criteria` |
| **B04** 打开 wikipedia.org | 3 | 3 | **1.00** | 全部 `go_to_url:observed` + completed |

**Mini-set TSR: 5/9 = 0.56**

## Evidence highlights

- B01 pass: `go_to_url` → e.g. `BV1Q1Km6BEBo`, `BV1PdKp6dEcq`；attempts 仅一条导航，非 index 点击。
- B04 pass: final `https://www.wikipedia.org/`。
- A02 fail: 开放式理解仍未闭环（criteria 空 / 假 proof）。

## Decision input (quality-first)

1. **导航类 + 确定性捷径有效**（B01/B04）→ 继续扩「可解析 URL 目标」的确定性路径，不跪 Nanobrowser index 链。  
2. **理解类 A0 不及格**（A02 0/3）→ 下一刀做 **A1：理解任务 completed + 答案落盘**（不靠 empty criteria hang/fail）。  
3. 未到换整核门槛：导航环已通；先补理解闭环再开 A2/A3 对照。

---

## A02 re-score after understanding fix (same day)

**Change:** empty criteria + non-empty summary → `completed` + receipt + answer on `instructionSummary`; understanding-only goals answer from live URL/title (deterministic).

| Task | Pass | n | TSR | Notes |
|------|------|---|-----|--------|
| **A02** | 3 | 3 | **1.00** | answer always `是。host=bilibili.com`; completed + receipt |

**Mini-set recompute (B01 valid 2/3 + A02 3/3 + B04 3/3):**  
B01 still 2/3 (first attempt env `invalid_transition`); **post-fix mini TSR ≈ 8/9 = 0.89** if counting A02 new only with prior B01/B04.

## Matrix

`reports/nanobrowser/bakeoff/2026-07-23-quality-matrix.csv`
