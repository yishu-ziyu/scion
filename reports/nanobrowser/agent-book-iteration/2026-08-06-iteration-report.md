# 2026-08-06 Agent Book 驱动迭代报告

## 结论

按《深入理解 AI Agent》+ 持节 019/021，本轮把 **长程上下文压缩、Mission/Plan、全量 ACI、Grok 4.5 model-swap、长程评估** 落地并真机验收。正式分仍绑定 MiniMax-M3；Grok 4.5 经本机 CLIProxyAPI `127.0.0.1:8317` 做对照。

## 能力落地（书本部件）

| 部件 | 改动 | 证据 |
|---|---|---|
| Context 压缩 | `context.ts` 轨迹窗口 + plan memory | 399 单测；`enableContextCompression` |
| Agent 状态栏 | active_phase + plan 注入 control | control-llm + control-policy |
| Mission/Plan | refine 标题、checkpoint、阶段推进 | mission-plan + manager |
| Tools ACI | 22 个 action 全量 when/not/examples | aci-prompt 5/5 |
| Prompt 版本 | `chijie-control-v0.3.0` | 长程规则进 system prompt |
| Model swap | `pnpm eval:grok` | 8317 smoke + matrix |
| Evaluation | `TASK_SET=long_horizon` | 021-LH-01..03 |
| Correct | 拒理解捷径误伤多阶段；公网误报 login 过滤 | understanding-answer + control-llm |

## 真机矩阵（可复现）

| 矩阵 | 模型 | 结果 |
|---|---|---|
| 013-A01, 013-B04 | MiniMax-M3 | 2/2 pass |
| 013-A01, 013-B04 | grok-4.5 | 2/2 pass |
| **021-LH-01/02/03** | **MiniMax-M3** | **3/3 pass**（`iter-lh-final`） |
| **021-LH-01/02** | **grok-4.5** | **2/2 pass**（`iter-lh-grok-final`） |
| 021-LH-03 + 013-B04 | MiniMax-M3 | 2/2 pass |

侧栏计划标题示例（LH-02）：`离开 / 打开 / 验证`（不再泄漏 `离开 e`）。

### 正式批量（MiniMax-M3，本轮收口）

`2026-08-06-iter-formal-batch`：**10/10 verified_pass**，`false_complete=0`

任务：`013-A01, A03, B04, B05, B06, B07, B08, 021-LH-01, LH-02, LH-03`

报告 CSV 目录：`reports/nanobrowser/eval/2026-08-06-iter-*`  
外环候选：`reports/nanobrowser/outer-rl/skills/candidates/021-LH-*.md`（12+ 张，R=10）

## 失败与修复环

1. **假完成**：多阶段目标被 `isUnderstandingOnlyInstruction` 误判 → 排除多阶段/编号步骤。
2. **login_wall 误报**：维基公网被模型标 login → 公网 URL 忽略 `login_required`。
3. **proof 挂起**：目标 URL 未进隐式 criteria → 从指令提取 wiki URL / 标题。
4. **网络 flake**：`ERR_CONNECTION_CLOSED` 重跑后过。
5. **013-B07 More information**：导航后冻结 criteria 导致 `already_true_at_baseline` → **先冻结再导航**；`verified_pass`（`iter-b07-r3`）。
6. **公开子集**：013-A01/A03/B04/B05/B06/B08 通过；B07 修复后通过。

## 命令

```bash
cd projects/chijie-browser
pnpm -F chrome-extension test   # 399 passed
pnpm build
TASK_SET=long_horizon RUNS=1 MODEL=MiniMax-M3 pnpm eval:matrix
source ~/.cli-proxy-api/client.env && pnpm eval:grok
```

## 下一刀（未停）

1. 阶段标题对「离开 example.com」类句仍偏「离开 e」→ 加强英文/短语 sanitize。
2. 长程任务隐式 criteria 与模型 criteria 冲突时的合并策略。
3. LLM 语义压缩（当前为确定性 archive）。
4. Wave 4 真站（飞书/B 站）仍需 Owner 登录态。
5. 外环 Skill 候选在长程轨迹上扩跑。
