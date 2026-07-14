---
status: candidate
policy_tag: baseline
reward_R: 10
source_matrix: YYYY-MM-DD-phase-A-baseline.csv
source_attempt: T1-fixture#1
model: MiniMax-M3
created: YYYY-MM-DD
---

# Skill 候选：〈简短名称〉

## 语义目标

用一两句话说用户要达成什么（无具体表单值）。

## 声明输入

| 名 | 类型 | 说明 |
|----|------|------|
| example_field | string | 用户运行时填写 |

## 完成条件（可观察）

- [ ] …
- 0 假完成
- 外部提交：批前 0 / 批后 ≤1

## 审批策略

- 外部提交：需要一次性批准
- AUTO_APPROVE：仅 fixture，禁止真实站

## 推荐执行提示（L0，无密钥/无隐私）

```text
（可复用的语义步骤说明，不写旧 selector 索引）
```

## 证据指针

- matrix row: …
- receipt: （若有 Task 回执 id，无则写 fixture run stamp）

## Owner 决定

- [ ] accept → 移到 `skills/accepted/`
- [ ] reject（原因：）
