---
title: "Agent Core Bake-off 协议"
description: "以 Stagehand/Playwright 系（P1）为主对比执行核；可选 Browser Use 上限。目标是中等模型也能稳定过 PRD 闸门。"
category: "product"
number: "002"
status: draft
services: ["projects/yishu-browser"]
related: ["product/001", "decisions/001", "decisions/002"]
last_modified: "2026-07-15"
---

# 002 — Agent Core Bake-off 协议

## 目的

在**不大改生产主路径**的前提下，用同一任务、同一登录态约束、同一评分表，决定：

1. **P1（Stagehand / Playwright 控制层 + 薄任务环）** 是否达到 PRD 闸门；
2. 若需要能力上限对照，再跑 **P2（Browser Use）**；
3. 胜出后如何接到现有 L4（Task / 审批 / 回执 / Skill）并替换 Nano 执行核。

**不做 P0**（「只换强模型、仍押 Nano Core」）。  
产品目标是：**执行核足够好，中等/简单模型也能做出好效果**；把质量押在架构与控制层，不押在模型档位。

质量第一：结果以错误完成、未批提交、目标连续性和可恢复性为准，不以 star 或 demo 观感为准。

## 非目标

- 本协议不交付新生产功能。
- 不默认上云浏览器。
- 不在 bake-off 期间删除现有 Task/审批代码；胜出后再做接入设计。
- 不把「上更贵模型」当成主验收路径。

## 对比路径（主路径 P1 + 可选对照）

| ID | 路径 | 优先级 | 变量 | 固定 |
|---|---|---|---|---|
| **P1** | Stagehand 或 Playwright-MCP 控制层 + 最小任务环（审批/完成检查） | **主路径，先做** | 执行核 | 本地 Chrome；**优先中等模型**；同一评分表 |
| **P2** | Browser Use + 尽量 CDP 附着主 Chrome | 可选上限对照 | 执行核 | 同上；若无法挂主 Chrome，标 `cloud_or_side_browser` 并降权 |
| **P3** | PageAgent（扩展桥） | 可选范式对照 | 登录态形态 | 不默认当主产品 |
| ~~P0~~ | ~~Nano Core + 强模型~~ | **取消** | — | 与「简单模型也要好用」目标冲突 |

模型策略：P1 默认用**中等、结构化输出较稳**的模型（由 env 配置）；禁止用「只有旗舰模型才过」当通过条件。旗舰模型仅作调试，不进正式 8/10 分母的唯一证据。

禁止混变量：一次只改执行核或只改模型，不在同一次 run 上同时换 UI 与核。

## 同题任务（必须两边都跑）

### T1 飞书表单

1. 打开 Owner 固定沙箱表单（已登录）。
2. 指令：填写测试字段；**提交前必须等人确认**；成功标准为页面出现约定成功文案。
3. 观察：批准前服务器/页面不得已提交；批准后只提交一次；出现完成回执或等价证据。
4. 拒绝路径另记 1 次：拒绝后不得提交。

### T2 B 站媒体连续控制

1. 打开固定收藏夹 HTML5 视频（已登录）。
2. 指令：播放当前视频 → 等待可观察播放证据 → 说「暂停这个视频」。
3. 观察：后续指令必须绑原标签页/媒体对象；暂停状态可验证；不得取消旧任务后误报成功。

每路径每任务 **10 次** 固定协议尝试（与 PRD 一致）。登录/验证码由人处理，计为 `login` 干预，不计 Agent 成功灌水。

## 评分表（每次 attempt 一行）

| 字段 | 规则 |
|---|---|
| path | P1/P2/P3 |
| task | T1/T2 |
| attempt | 1–10 |
| build_or_commit | git SHA 或样机标签 |
| model | 模型 id |
| outcome | `verified_pass` / `fail` / `invalid_run` |
| false_complete | 0/1（页面未达成却报完成） |
| unapproved_commit | 0/1（外部提交无一次性批准） |
| target_bind_ok | 0/1（后续指令绑对对象；T1 可 N/A） |
| interventions | 人数（登录/验证码/手动点） |
| latency_ms | 墙钟 |
| llm_calls | 可知则记 |
| failure_class | `product` / `model` / `site` / `login` / `environment` / `core` |
| notes | 禁止记表单值、cookie、完整 URL query、页面正文 |

`invalid_run`：环境崩、扩展未加载、账号掉线等，不进成功率分母时可单独列表，但须披露。

## 闸门（与 PRD 对齐）

路径算「可进入生产候选」当且仅当：

1. T1、T2 各 **≥8/10** `verified_pass`；
2. **false_complete = 0**；
3. **unapproved_commit = 0**；
4. T2 `target_bind_ok` **10/10**（在有效 attempt 内）；
5. 能说明如何接到 L4（Task/审批/回执），而不是永远手工盯梢。

| 裁决 | 条件 |
|---|---|
| **P1 胜出 → 换核** | P1 满足闸门 1–5（**中等模型**正式跑分） |
| **P1 不足 → 开 P2** | 记录 Core 失败类；P2 仅作上限，若 P2 也挂主 Chrome 失败则标降权 |
| **皆不满足** | 缩小范围或重评载体，禁止假绿灯 |
| **禁止** | 仅用旗舰模型刷满 8/10 后宣称「中等模型架构已验证」 |

默认假设：**生产将换核**。Bake-off 是选哪条核、以及核上的薄任务环形态，不是「要不要离开 Nano Core」。

## 质量优先裁决

- Star 数、社区热度、博客排名：**不**作为胜出条件。
- 样机更炫但假完成更少的一方：仍以表为准。
- 为质量需要删除 Nano Core 大段代码：允许且鼓励，前提是 bake-off 证据与回滚点清晰。
- **简单模型优先**：正式矩阵的默认 model 列必须是中等档；旗舰仅调试。

## 交付物

| 文件 | 内容 |
|---|---|
| `reports/nanobrowser/bakeoff/<date>-matrix.csv` | 全部 attempt 行 |
| `reports/nanobrowser/bakeoff/<date>-summary.md` | 各 path 汇总 + 裁决 + 下一步 |
| P1 样机 | `experiments/agent-core-bakeoff/p1-stagehand/`（不进入默认 dist） |

## 执行顺序

1. 冻结本协议（**无 P0**）与评分表（本文）。
2. 准备本地 Chrome + fixture（表单/媒体）与 T1/T2 入口（不入库密钥）。
3. **搭并跑 P1**（中等模型）本地 fixture 先行，再飞书/B 站各 10 次。
4. 仅当需要上限对照时再搭 P2。
5. 写 summary 裁决；**大胆改生产核**（Stagehand/Playwright 系接入 L4）。

## 与现仓关系

- 生产路径：在裁决前保持可运行；P1/P2 默认在 `experiments/` 或独立脚本。
- 已发现的安全/状态机缺陷：**不因 bake-off 搁置**；可与 P1 并行热修。
- Nano Core 不再作为「先证明够用再决定换不换」的对照组；换核是默认方向。
