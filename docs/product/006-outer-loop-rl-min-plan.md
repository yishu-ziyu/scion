---
title: "外环 RL 最小方案（个人玩家 · Token 消耗）"
description: "可选后续项：在可验证闸门上多次 rollout，用奖励筛轨迹并沉淀 Skill；不训权重。当前只写方案，不默认执行。"
category: "product"
number: "006"
status: draft
services: ["projects/chijie-browser", "experiments/agent-core-bakeoff"]
related: ["product/001", "product/003", "product/004", "product/005", "design/002"]
last_modified: "2026-07-15"
---

# 006 — 外环 RL 最小方案

## 状态（Owner 裁定）

| 项 | 值 |
|----|-----|
| 文档角色 | **方案归档**，供以后加项时用 |
| 是否默认执行 | **否** |
| 与当前里程碑 | **不占用** M3；不改 `current_milestone` |
| 何时再开 | Owner 明确说「开外环 RL / 跑阶段 A」之后 |

未获当轮授权前：不跑矩阵、不改默认 prompt/控制环、不把本方案写进会话默认待办。

## 一句话

用**已有闸门当奖励函数**：同一任务多跑几遍 → 自动打分 → 只保留高分轨迹与可复用 Skill。  
**不**更新 frontier 模型权重；**不**用旗舰模型刷正式分。

## 解决什么问题

| 问题 | 本方案回答 |
|------|------------|
| Token 剩很多，往哪烧才对产品有用 | 烧在 **verified 矩阵 + 失败分类 + Skill** |
| 个人玩家做不到真 RL 训权重 | 做 **外环**：策略 = prompt / 工具偏好 / Skill / 重试规则 |
| 和北极星什么关系 | 服务 G1–G4 成功率与 M4 Skill，不另起产品线 |

## 非目标

- 不训 OpenAI / MiniMax / 自有 70B 权重（PPO/GRPO 全参）
- 不把旗舰分数写进 G5 正式分母
- 不做推荐/广告式 A/B 流量实验
- 不扩大黄金旅程任务句中途改词（改则新开分母）
- 不存表单值、Cookie、页面正文进轨迹库（遵守 G7）

## 学什么（策略对象）

按易到难，只动「壳与配方」，不动核的沉没承诺：

| 层级 | 对象 | 个人玩家可操作性 |
|------|------|------------------|
| L0 | 任务句措辞 / 系统侧约束片段 | 立刻 |
| L1 | 工具顺序偏好（先 DOM 再截图、媒体走 element API） | 立刻 |
| L2 | 重试与中止规则（model_loop 上限、审批超时） | 立刻 |
| L3 | **本地 Skill**（语义模板，非坐标回放） | 有 verified 回执后 |
| L4 | 小模型 / LoRA 可选 | 仅当 L0–L3 有 ≥50 条干净轨迹再议 |

本方案默认做完 **L0–L3** 即止。

## 奖励函数（与闸门同一套）

每条 attempt 结束后算标量 `R`：

```text
R = 0
if outcome == verified_pass:     R += 10
if false_complete == 1:          R -= 10
if unapproved_commit == 1:       R -= 20
if failure_class == model_loop:  R -= 3
if failure_class == selector_miss: R -= 2
# 可选稠密项（有数据再开）
R -= min(step_count, 40) * 0.05     # 更短更好，封顶
R -= min(latency_ms, 120000) / 60000  # 超时轻罚
```

| 结果 | 含义 |
|------|------|
| `R >= 9` | 成功候选；可进 Skill 候选池 |
| `0 <= R < 9` | 弱成功或未跑满证据；不进 Skill |
| `R < 0` | 失败；写入失败分类，供改 L0–L2 |

**正式成功率**仍只报：`verified_pass / 有效 attempt`（见 `product/003`）。  
`R` 只用于 **组内排序与 Skill 筛选**，不替代 91.8% 口径。

## 跑哪些任务（分母）

| 阶段 | 任务 | 闸门 | 模型 | n 建议 | 是否阻塞 Owner |
|------|------|------|------|--------|----------------|
| **A 回归基线** | fixture 表单 + 媒体 | G1 G2 | **MiniMax-M3** | 各 10 | 否 |
| **B 难例探路** | 同 fixture + 扰动（慢网/打乱 DOM 顺序若有） | 服务 G1 G2 稳健性 | M3 为主；旗舰仅 debug | 各 5–10 | 否 |
| **C 真实站** | 飞书 / B 站冻结句 | G3 G4 | **MiniMax-M3** 正式 | 10 或累计 ≥50 | **是**（登录态） |
| **D Skill 重跑** | 成功 Skill + 换输入 | PRD Skill / M4 | M3 | ≥3 | 视站点 |

**若将来启动，默认起点：阶段 A。**  
M3（阶段 C）仍按 `product/005`；`run_state` 为 `blocked_on_owner_login` 时不装作成绩。  
**当前（方案期）：** 不跑 A/B/C/D。

## Token 怎么分

| 用途 | 模型 | 比例建议 | 说明 |
|------|------|----------|------|
| 正式分 / 矩阵 | MiniMax-M3（Token Plan） | **~80%** | 唯一进 G1–G4 分母 |
| 失败归因文案、难例构造、judge 草稿 | 旗舰或闲置额度 | ~15% | **不得**写入正式成功率 |
| 人类可读 summary / 报告 | 任意便宜模型 | ~5% | 可本地脚本生成则省掉 |

原则：**额度多 ≠ 用旗舰刷分**（G5）。  
闲置 token 优先加 **A/B 的 attempt 数** 和 **失败复盘**，不是换模型。

## 输出落盘（唯一约定）

根目录：`reports/nanobrowser/outer-rl/`

| 文件 | 内容 |
|------|------|
| `README.md` | 本目录操作说明（短） |
| `template-rollout.csv` | 单次 attempt 行模板 |
| `template-skill-candidate.md` | Skill 候选卡模板 |
| `YYYY-MM-DD-phase-A-matrix.csv` | 阶段 A 矩阵 |
| `YYYY-MM-DD-phase-A-summary.md` | 成功率、R 分布、失败分类 |
| `skills/candidates/*.md` | 高分轨迹 → Skill 草稿（无表单值） |
| `skills/accepted/*.md` | Owner 确认可进产品的 Skill 语义 |

CSV 列（在 bakeoff 模板上扩展）：

```text
path,task,attempt,build_or_commit,model,outcome,false_complete,unapproved_commit,target_bind_ok,failure_class,step_count,latency_ms,llm_calls,reward_R,policy_tag,notes
```

- `policy_tag`：本轮 L0–L2 策略版本，例如 `baseline` / `media_api_first` / `retry_cap_3`
- `reward_R`：上表公式结果，两位小数即可

真实站矩阵仍可双写：`reports/nanobrowser/golden/`（`product/005`）+ 本目录副本或 symlink 说明。

## 最小循环（每天可跑完）

```text
1. 选定 policy_tag（只改一个变量）
2. 跑阶段 A（或 C 若已登录）
3. 写 CSV 每一行 + 算 R
4. 汇总：verified 率、R 均值、failure_class 直方图
5. R>=9 且 0 假完成 → 填 Skill 候选卡（无敏感字段）
6. 对比上一 policy_tag：只保留不伤成功率的改动
7. 在 summary 写一句：是否推进 M3 / 是否改 L0–L2
```

命令锚点（阶段 A，已有）：

```bash
cd experiments/agent-core-bakeoff/p1-stagehand
AUTO_APPROVE=1 HEADLESS=true RUNS=10 MATRIX_LABEL=outer-rl-phase-A \
  node scripts/run-matrix.mjs
# 产出默认在 reports/nanobrowser/bakeoff/；复制或改 reportDir 到 outer-rl/
```

阶段 C：按 `product/005` 手跑或后续脚本；**禁止** AUTO_APPROVE 打开真实外部提交。

## 与里程碑关系

| 里程碑 | 本方案角色 |
|--------|------------|
| M1 已完成 | 阶段 A = 回归，防外环改策略把 10/10 打穿 |
| M2 已完成 | `policy_tag` 默认绑 `control` 核；对比 `nano` 时单独 tag |
| **M3 进行中** | 阶段 C 是主收益；未登录前只做 A/B |
| M4 | 阶段 D = Skill 保存与换输入重跑的数据来源 |
| G5–G8 | 正式分模型与声明纪律不变 |

**不改变** `current_milestone: M3`。本文件是 **并行加速器**，不是新主线。

## 完成定义（本方案自身）

两周内同时满足即算外环 RL v0 做成：

1. 至少 **2 个** `policy_tag` 在阶段 A 各有完整 10+10 矩阵 CSV  
2. summary 中有 **failure_class 分布** 与 **R 分布**  
3. 至少 **1 个** Skill 候选（R≥9、无敏感字段）进 `skills/candidates/`  
4. 未把旗舰 run 算进正式 verified 率  
5. Owner 能根据 summary 决定：是否把某 `policy_tag` 写进默认 prompt/控制环

## 风险

| 风险 | 对策 |
|------|------|
| 样本少，R 噪声大 | 固定任务句；先比 policy，不宣称「学到智能」 |
| 轨迹泄露隐私 | 落盘前剥输入值；只留语义步骤类型 |
| 为刷 R 缩短必要审批 | `unapproved_commit` 重罚；真实站禁止 AUTO_APPROVE |
| 与 M3 抢注意力 | 未登录只跑 A；登录日整天只跑 C |

## 以后若要启动（清单，非现在）

1. Owner 当轮明确授权「开外环 RL」  
2. 跑阶段 A baseline → `outer-rl/` 落盘  
3. 选一个 `policy_tag` 对比（例如 `media_api_first`）  
4. 有登录日后视情况开阶段 C  

实现代码改动仍须遵守 `product/004`：能指到 G# 或本文条目。  
**现在：** 规格停在本文 + 空证据目录即可。
