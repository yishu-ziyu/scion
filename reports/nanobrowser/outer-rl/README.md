# Outer-loop RL（外环）证据目录

规格：`docs/product/006-outer-loop-rl-min-plan.md`（**draft · 暂不执行**）  
北极星：`docs/product/003-north-star.md`  
正式分模型：**MiniMax-M3 only**

**当前：** 只预留目录与模板；Owner 未授权前不要跑矩阵、不要当会话默认任务。

## 目录约定

```text
outer-rl/
  README.md                      ← 本文件
  template-rollout.csv           ← attempt 行模板
  template-skill-candidate.md    ← Skill 候选卡
  YYYY-MM-DD-phase-A-*.csv       ← 阶段 A 矩阵
  YYYY-MM-DD-phase-A-*-summary.md
  skills/candidates/             ← R≥9 草稿
  skills/accepted/               ← Owner 确认
```

## 阶段 A 最短路径

```bash
cd experiments/agent-core-bakeoff/p1-stagehand
AUTO_APPROVE=1 HEADLESS=true RUNS=10 MATRIX_LABEL=outer-rl-phase-A-baseline \
  node scripts/run-matrix.mjs
```

脚本默认写入 `reports/nanobrowser/bakeoff/`。  
跑完后把 CSV/summary **复制**到本目录，并补列：`reward_R,policy_tag,failure_class,step_count`（无则手工填）。

或一次性：

```bash
STAMP=$(date +%F)
cp ../../reports/nanobrowser/bakeoff/${STAMP}-outer-rl-phase-A-baseline.csv \
   ../../reports/nanobrowser/outer-rl/${STAMP}-phase-A-baseline.csv
```

（路径以你 cwd 为准；也可用绝对路径。）

## 奖励 R（抄自 006）

```text
verified_pass +10
false_complete -10
unapproved_commit -20
model_loop -3
selector_miss -2
optional: -0.05*min(steps,40) - latency_ms/60000 (cap 120s)
```

`R >= 9` 才进 `skills/candidates/`。

## policy_tag 示例

| tag | 含义 |
|-----|------|
| `baseline` | 当前 control 默认行为 |
| `media_api_first` | 媒体优先 element API，不赌 shadow 点击 |
| `retry_cap_3` | 同一步失败最多 3 次再中止 |

一次对比只改一个 tag。

## 禁止

- 旗舰模型行写入「正式成功率」叙述  
- 真实站 AUTO_APPROVE  
- Skill 里写表单值 / Cookie / 完整 URL query
