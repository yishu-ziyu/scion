---
title: "dev-contract-010 L1 no_progress seal v1"
status: frozen
version: v1
owner: G1
spec_author: G2
implementer: G3
verifier: G4
created: "2026-07-16"
---

# Contract 010-v1 — 复杂任务 L1：无进展必须停机

## 问题（G1）

当用户委托**多步复杂网页任务**时，持节若在观察几乎不变的情况下反复空转，用户看到的是「束手无策」。
L1 内环必须在**无进展**时带失败类停机，而不是烧光 `maxSteps` 才闷死（或看起来像死机）。

## 非目标

- 不解决飞书真站批准旅程（票 06）本身
- 不改 UI 文案体系
- 不引入外环 RL
- 不动 W\* 协作窗

## 范围（唯一竖切）

在 `runObserveActLoop`（`projects/chijie-browser/.../observe-act-loop.ts`）中：

1. 增加失败类 **`no_progress`**
2. 当连续 **`maxNoProgress`** 次（默认 **3**）成功走完 act（无 error）后，**reobserve/下一观察文本与触发该 act 前的观察文本相同**（trim 后全等），则返回  
   `{ kind: 'failed', category: 'no_progress' }`
3. 任意一次观察文本变化 → 重置无进展计数
4. act 报错走现有 failure 预算，**不**计入 no_progress 成功停滞
5. `maxSteps` 耗尽行为保持：`category: 'max_steps'`
6. 新增选项 `maxNoProgress?: number`（默认 3；`<=0` 视为关闭该检测）

## Evals（G4 必须跑）

| ID | 当… | 应… |
|----|-----|-----|
| E1 | decide 每步都 action，act 成功，observe/reobserve 始终同一字符串，maxNoProgress=3 | 第 3 次相同后 `failed/no_progress`，步数 < maxSteps |
| E2 | 中途 reobserve 文本变化 | 计数清零，可继续直至 done |
| E3 | maxNoProgress=0 | 不因相同观察触发 no_progress；可落到 max_steps |
| E4 | 现有 ticket 02 导航绿测 | 全过（无回归） |

命令（在 chijie-browser 根）：

```bash
pnpm -F chrome-extension test -- src/background/agent/backends/__tests__/observe-act-loop.test.ts
```

退出码 0 为 G4 PASS 必要条件。

## 完成定义

- [x] G3：实现 + 单测覆盖 E1–E3，E4 不红
- [x] G4：上述命令退出 0 + 本文件 checklist 勾完
- [x] G1：010 协议 Progress log 写一行

## G3 回传（2026-07-16）

- 文件：`projects/chijie-browser/chrome-extension/src/background/agent/backends/observe-act-loop.ts`
- 测试：`.../__tests__/observe-act-loop.test.ts`（+E1–E3）
- 顺手：`failure-taxonomy.ts` 将 `no_progress` → 产品码 `model_loop`
- 命令：`pnpm -F chrome-extension test -- src/background/agent/backends/__tests__/observe-act-loop.test.ts` → **exit 0，10/10**

## G4 回传

- 证据：`reports/nanobrowser/2026-07-16-contract-010-l1-no-progress-g4.md` → **PASS**

## 回传格式

**G3：** 改动文件列表；测试命令；exit code；未做项  
**G4：** PASS/FAIL；证据（命令输出摘要路径或粘贴末 20 行）；失败类若有
