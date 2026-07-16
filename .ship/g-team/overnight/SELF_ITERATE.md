# 持续改错 + 自我迭代（G1 怎么获得这种能力）

## 结论（调研压成一句）

**模型不会「自己变聪明」；能力来自模型外的 harness：失败写盘 → 分类 → 改策略/改评测/改工具 → 再跑 → 用可观察证据决定保留。**

同结构见：Ng 的 loop engineering、gnhf 迭代 notes、Addy Osmani 的 progress 日志、Self-Harness（挖弱项→改脚手架→验证）、Karpathy 式 autoresearch（改→跑→比分→留/弃）。

## 四件硬零件

| 零件 | 本过夜落点 | 作用 |
|------|------------|------|
| **1. 轨迹/错误账本** | `ERRORS.md` | 每次失败：类 / 证据路径 / 假设 / 下一试 |
| **2. 可复用教训** | `LESSONS.md` | 同错≥2 → 一条 durable lesson（策略变更） |
| **3. 评测/停机条件** | golden 矩阵 + contract evals + gnhf `--stop-when` | 用分数/exit 决定是否进步，禁止「感觉好了」 |
| **4. 短周期外环** | **3 分钟心跳** + gnhf 迭代 | 强迫读盘、对照错误、禁止空转 |

## 每拍自我迭代环

```text
读 LESSONS + ERRORS + 最新 log
  → 做一小步（派 G 或跑脚本或修一点）
  → 观察（exit / 页证 / handoff）
  → 若 FAIL：写 ERRORS；若同类≥2：升 LESSONS 并改下一试
  → 若 PASS：勾任务；禁止再犯已写 lessons
  → 写 HEARTBEAT 一行
```

## 禁止

- 同一失败原样重试（无新假设）
- 嘴上「改进了」无盘上证据
- 用聊天记忆代替 ERRORS/LESSONS

## 与四线 / gnhf / Matt

| 层 | 谁迭代什么 |
|----|------------|
| G4 | 只证伪，把 FAIL 类写清（喂 ERRORS） |
| G3 | 按 lesson 改实现 + 测 |
| G2 | 失败模式升成 contract/eval |
| G1 | 编排环、合并 lesson、重派 |
| gnhf | 代码竖切上的自动 plan→verify 循环 |
| Matt | 过线唯一标准：命令+exit+路径/页证 |

## 心跳

- 原 10m 已取消  
- 现：**每 3 分钟** durable scheduler（见 HEARTBEAT 最新条 ID）
