# Book × 持节 能力差距矩阵（2026-08-06 迭代轮）

## 结论

书本要求的生产 Harness 部件，持节 Wave 0–2 已搭骨架；本轮主攻 **021 下一项（语义上下文压缩 + 计划记忆 + 中断恢复）**，并用 **Grok 4.5（本机 8317）** 做 model-swap / 长程评测，正式分仍绑定 MiniMax-M3。

## 书本部件对照

| 书本部件 | 书源 | 持节现状 | 本轮动作 |
|---|---|---|---|
| Model + model swap | ch1/ch6 | MiniMax-M3 默认；swap 脚本有 | 接 Grok 4.5 via 8317 |
| Context / 状态栏 | ch2 | 代码状态栏已有；压缩仅首尾截断 | **语义轨迹压缩 + 计划记忆** |
| Tools ACI | ch4 | 部分 action 有 ACI | **全量 ACI** |
| Loop Observe-Act | ch1/ch5 | control + observe-act-loop | 保持；失败簇迭代 |
| Constrain / flags | ch1/ch5 | eval feature flags | 加 `enableContextCompression` |
| Verify | ch6 | CompletionChecker | 长程 criteria |
| Correct / retry | ch5 | retry-policy | 保持 |
| Evaluation | ch6 | eval-matrix | **长程 task set** |
| Observability | ch6 | trace.ts | 保持 |
| Evolution | ch8 | outer-loop 部分 | 轨迹→Skill 候选继续收 |
| Computer Use 业务 | ch9 | Snapshot frame + media | 业务捷径 + 通用原语 |
| Mission/Plan 长程 | 021 | 骨架阶段 | **精炼标题 + checkpoint 恢复** |

## 本机 Grok 接入（已验证）

```bash
source ~/.cli-proxy-api/client.env
# GET http://127.0.0.1:8317/v1/models → 含 grok-4.5
# POST /v1/chat/completions model=grok-4.5 → content "OK" (2026-08-06 smoke)
```

- 正式成功率：MiniMax-M3
- 调试 / swap / 长程研究：`grok-4.5` @ `127.0.0.1:8317`

## 并行执行轨道

1. 语义上下文压缩
2. Mission plan refine + resume
3. 全量 ACI
4. Grok 4.5 eval 接线
5. 长程评估任务集

## 非目标

- 不训权重；不做 Memory 产品；不因 30 故事硬编码 30 功能；不跳过评估宣称 Tabbit 对齐。
