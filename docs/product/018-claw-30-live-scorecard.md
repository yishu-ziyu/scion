---
title: "Claw 30 例真机记分板（强制全跑）"
description: "Sider Claw 30 个演示故事的持节跑分 SSOT。禁止只抽子集宣称对标；个性化工作不得抢在本表之前。"
category: "product"
number: "018"
status: current
services: ["projects/chijie-browser"]
related:
  - "product/016"
  - "product/017"
  - "product/015"
  - "product/research/sider-claw/016-sider-claw-demo-catalog-and-ux"
  - "design/005"
last_modified: "2026-07-24"
---

# 018 — Claw 30 例真机记分板

## Owner 纪律（2026-07-23 冻结）

1. **30 例全部要跑**，不得用「先 3～5 条 tracer」替代全表。  
2. 跑不过 Claw 示例效果 → **不得**宣称对标完成，也 **不得** 把精力先堆到更远的个性化。  
3. 每条必须有：`run` 状态 + 证据路径 + 差距一句。  
4. 状态码：
   - `not_run` — 还没按本行验收句跑过  
   - `auto_proxy` — 仅单元/journey 近似，**不算** Claw 故事过关  
   - `partial` — 真机或 e2e 跑了，效果明显弱于 Claw 演示  
   - `fail` — 跑了，达不到验收  
   - `pass` — when I do X → I see Y 相对 Claw 故事成立（允许实现路径不同，**用户可见终点**要对齐）  
5. **宣称 Claw 80% / 个性化就绪** 的前置：`pass` 数达到 016 的 M-80 定义（M0–M4 故事），且本表无「关键路径全是 not_run」。

## 当前总览（更新于 2026-07-24）

| 簇 | 条数 | pass | partial | fail | auto_proxy | not_run |
|----|------|------|---------|------|------------|---------|
| Research R1–R8 | 8 | 0 | **1** (R1) | 0 | 0 | **7** |
| Transform T1–T8 | 8 | 0 | 0 | 0 | 0 | **8** |
| Generate G1–G8 | 8 | 0 | 0 | 0 | 0 | **8** |
| Operate O1–O6 | 6 | **1** (O1) | 0 | 0 | 0 | **5** |
| **合计** | **30** | **1** | **1** | **0** | **0** | **28** |

**一句话：O1 pass；R1 partial（本地列表 e2e 抽出 6 行 CSV，非 Amazon 真机）；其余 28 not_run。媒体播停 e2e 已绿但不进 30 例。**

相关但非 30 目录：B 站「播+评论」手测 = **partial 多意图**；`e2e:action-agent` 媒体播/停 = **2026-07-24 全绿**（fixture 30s+loop，见 `reports/nanobrowser/claw-30/media/`），仍不进 30 例 pass 列。

---

## 逐条记分

### Research（8）

| ID | 故事（Claw） | 持节验收终点（用户可见） | 状态 | 证据 | 还差什么 |
|----|--------------|--------------------------|------|------|----------|
| R1 | Amazon 列表→价格/评分表 | 可打开 CSV/MD 表，≥N 行商品字段 | **partial** | `e2e:r1-extract` PASS（6 行 CSV）；`reports/nanobrowser/claw-30/R1/` | **Amazon 真机**；文件下载入口；长列表滚动 |
| R2 | Ahrefs SEO 竞品 | 对比洞察可读；登录墙诚实 | not_run | — | 真会话附着、长任务、登录策略 |
| R3 | 招聘页→简报 | 简报 MD/可复制 | not_run | — | 列表抽 + 写文档 |
| R4 | 低星评论→痛点 | 结构化痛点列表 | not_run | — | 长列表滚动 + 聚类 |
| R5 | Reddit 热帖→清单 | 清单/表 | not_run | — | 多页、反爬 |
| R6 | YouTube 元数据→表 | 表/CSV | not_run | — | 元数据抽 + 写表（slice-a 仅近邻） |
| R7 | 多站活动→一表 | 聚合表 | not_run | — | 跨站调度 |
| R8 | 联系页→邮箱电话表 | 字段表 | not_run | — | 字段抽取 |

### Transform（8）

| ID | 故事（Claw） | 持节验收终点 | 状态 | 证据 | 还差什么 |
|----|--------------|--------------|------|------|----------|
| T1 | 英文文→中文商业摘要 | 可复制摘要或本地 MD | not_run | — | 正文抽取 + 导出 |
| T2 | 新闻→高管简报 | 简报 MD | not_run | — | 多源 + 写文档 |
| T3 | 报告→邮件草稿 | 可复制草稿 | not_run | — | 草稿交付 UI |
| T4 | 跨平台比课→邮件 | 对比 + 邮件草稿 | not_run | — | 多站 + 草稿 |
| T5 | 邮件主题创意清单 | 清单 | not_run | — | 轻量收集 |
| T6 | LinkedIn→嘉宾表 | 表 | not_run | — | 登录墙/公开页策略 |
| T7 | newsletter 源清单 | 表 | not_run | — | 搜索 + 表 |
| T8 | 主页→改版提案 | 提案 MD | not_run | — | 结构模板 |

### Generate（8）— 可后置 M5，但仍须记分；不得假装已跑

| ID | 故事（Claw） | 持节验收终点 | 状态 | 证据 | 还差什么 |
|----|--------------|--------------|------|------|----------|
| G1 | 研究→PPT | 可下载 pptx 链接 | not_run | — | 文件生成管线 |
| G2 | 对比→PDF | 可下载 PDF | not_run | — | 同上 |
| G3 | 长文→Podcast | 脚本+音频 | not_run | — | 非纯浏览器核 |
| G4 | 数据→图报告 | 报告文件 | not_run | — | 图表 + 多源 |
| G5 | 定价页→Excel | xlsx 或先 CSV | not_run | — | 写表/导出 |
| G6 | LinkedIn→简历 PDF | PDF | not_run | — | 登录墙 + PDF |
| G7 | PH→发布工具包 | MD 包 | not_run | — | 分析 + 打包 |
| G8 | 产品页→5 社媒角度 | 可复制草稿 | not_run | — | 草稿交付 |

### Operate（6）

| ID | 故事（Claw） | 持节验收终点 | 状态 | 证据 | 还差什么 |
|----|--------------|--------------|------|------|----------|
| O1 | 演示表单填好、**提交前停** | 字段已填；未批 0 提交；批 1 次提交 | **pass** | `pnpm -F chrome-extension e2e:action-agent` PASS（2026-07-24）；`reports/nanobrowser/claw-30/O1/` | 验收终点已对齐 fixture；Claw Salesforce 演示站视觉/长表单仍可加码 |
| O2 | 一条提示→多日历事件 | 日历多事件创建 | not_run | — | 日历权限/集成 |
| O3 | 多 SaaS 引导填、提交前停 | 多站填 + 批准门 | not_run | — | 跨站会话 + 同 O1 |
| O4 | 机票→推荐邮件 | 方案 + 草稿 | not_run | — | 搜比 + 草稿 |
| O5 | G2 评论→对比邮件 | 优缺点 + 草稿 | not_run | — | 读评 + 草稿 |
| O6 | 租房→推荐邮件 | 推荐邮件 | not_run | — | 列表比 + 草稿 |

---

## 工程近似（不进 pass 列）

| 近似 | 状态 | 说明 |
|------|------|------|
| form-journey（O1 核） | unit proxy | 批准门单测仍有效；真 e2e 已升 O1=pass |
| product-table-journey（R1 核） | auto_proxy | fixture 列表→CSV summary；≠ 真机 Amazon |
| media-journey（播停） | auto_proxy pass | ≠ Claw 目录条目；服务 M1/T0 |
| B 站手测播+评论 | partial 手测 | 假完成已修代码；评论交付仍弱 |
| Activity / displaySummary | code ready | UX 壳，不替代 30 故事终点 |

---

## 跑分顺序（全表，不是抽样放弃）

必须 **30 行都有至少一次 `not_run`→其他** 的更新。推荐波次（仍覆盖全表，只是时间序）：

1. **波次 A — Operate 可见环：** O1 真机 → O3 →（O2 若有日历）  
2. **波次 B — Research 抽表：** R1 → R8 → R6 → R7 → R4 → R3 → R5 → R2  
3. **波次 C — Transform 交付：** T1 → T3 → T8 → T2 → T5 → T7 → T4 → T6  
4. **波次 D — Generate 文件：** G5 CSV → G8 → G7 → G1/G2 → 其余  

每波更新本表 + `reports/nanobrowser/claw-30/<ID>/` 证据。

---

## 与 016 / 017

| 文档 | 角色 |
|------|------|
| 016 | 能力簇与里程碑映射 |
| 017 | 里程碑门 when I do X |
| **018（本文）** | **30 例是否真的跑过、结果是什么** |

聊天里说「做到哪了」以 **本文总览表** 为准。
