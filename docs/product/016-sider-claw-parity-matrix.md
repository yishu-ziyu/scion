---
title: "Sider Claw 30 例 → 持节验收矩阵"
description: "将 Claw 落地页 30 个演示映射为持节能力簇、里程碑、验收句引用与当前缺口；作为 80% 对标清单。"
category: "product"
number: "016"
status: current
services: ["projects/chijie-browser"]
related:
  - "product/011"
  - "product/013"
  - "product/014"
  - "product/015"
  - "design/005"
  - "product/research/sider-claw/016-sider-claw-demo-catalog-and-ux"
  - "decisions/003"
last_modified: "2026-07-23"
---

# 016 — Sider Claw 30 例 → 持节验收矩阵

## 一句话

**30 个演示是同一 Agent 环的验收故事。**  
持节用本表判断「复刻 80%」走到哪，不另起功能清单。

源目录：`docs/product/research/sider-claw/016-sider-claw-demo-catalog-and-ux.md`  
UX 原则：`docs/design/005-chijie-task-ux-from-claw.md`  
T0 探针句：`docs/product/015-jarvis-acceptance-sentences.md`

## 里程碑（与 80% 口径）

| 里程碑 | 含义 | 约覆盖故事形态 |
|--------|------|----------------|
| **M0 UX 壳** | design/005：步骤人话、停止、完成句、页内条（可渐进） | 全部案例的「看得见」 |
| **M1 Parity 环** | 附着 + observe-act + 证据完成；关页/播停/指代 | 操作基础，非 30 全文 |
| **M2 Research 表** | 多站读 + 结构化抽取 + 可打开表/CSV | R 类为主 |
| **M3 Operate-safe** | 填表 + 提交前批准；0 未批提交 | O1 O3 核心 |
| **M4 Deliverable** | 读页 → 摘要/邮件草稿/本地文档链接 | T 类 + 部分 G/O 邮件 |
| **M5 File pack** | PPT/PDF/Excel/音视频工具包 | G 类重文件（可后置） |
| **M-80** | M0–M4 达标 + 固定集 TSR；G 类可选 | 用户口径约 80% |

**默认：M5 不挡 M-80 宣称**（除非 Owner 改口）。

## 状态图例

| 码 | 含义 |
|----|------|
| `none` | 未做 |
| `partial` | 有环/有壳，缺该故事关键能力 |
| `ready` | 工程上可跑验收句 |
| `live` | Owner 真机矩阵有分 |

当前默认多为 `partial`/`none`；随实现更新本表，勿虚报 `live`。

**真机跑分 SSOT（强制全 30）：** [`018-claw-30-live-scorecard.md`](018-claw-30-live-scorecard.md)。  
Owner 2026-07-23：30 例都要跑；跑不过 Claw 效果不宣称对标；个性化不得抢跑。

---

## 矩阵

### Research（8）

| ID | 标题 | 能力簇 | 里程碑 | 持节状态 | 验收锚点 | 缺口 |
|----|------|--------|--------|----------|----------|------|
| R1 | Amazon 价格追踪 | 搜+列表抽+写表 | M2 | partial | 015 扩：抽表句；多 tab | extract 产品化、写表成果链接 |
| R2 | 竞争性 SEO 洞察 | 登录站只读+对比 | M2 | none | 需登录墙 failure | 登录站策略、长任务 |
| R3 | 招聘信号简报 | 列表抽+简报 | M2+M4 | none | 摘要交付 | 写文档 |
| R4 | 评论痛点挖掘 | 评论抽+聚类 | M2+M4 | none | 结构化痛点 | 长列表滚动 |
| R5 | Reddit 话题扫描 | 多页热帖→清单 | M2 | none | 表/MD | 反爬/登录 |
| R6 | YouTube 话题调研 | 元数据→Sheets | M2 | partial | 015 媒体+抽 | 元数据抽、写表 |
| R7 | 活动情报表 | 多站聚合表 | M2 | none | 多 host | 跨站调度 |
| R8 | 公司联系方式采集 | 联系页字段→表 | M2 | none | 字段抽取 | extract |

### Transform（8）

| ID | 标题 | 能力簇 | 里程碑 | 持节状态 | 验收锚点 | 缺口 |
|----|------|--------|--------|----------|----------|------|
| T1 | 文章摘要文档 | 读正文→Docs | M4 | none | 中文摘要文件 | 正文抽取+导出 |
| T2 | AI 趋势简报 | 多文→简报 | M4 | none | 简报 MD | 多源 |
| T3 | 报告转邮件草稿 | 文→邮件 | M4 | none | 草稿可复制 | 邮件集成可选 |
| T4 | 课程推荐 | 跨站比→邮件 | M2+M4 | none | 对比表+邮件 | 多站 |
| T5 | 邮件主题创意 | 收集→清单 | M2+M4 | none | 清单 | 轻 |
| T6 | 演讲者资料表 | 社媒页→表 | M2 | none | 表 | LinkedIn 墙 |
| T7 | 新闻通讯来源清单 | 搜索→表 | M2 | none | 表 | — |
| T8 | 网站改版提案 | 读站→提案 | M4 | none | 提案 MD | 结构模板 |

### Generate（8）— 默认后置 M5

| ID | 标题 | 能力簇 | 里程碑 | 持节状态 | 验收锚点 | 缺口 |
|----|------|--------|--------|----------|----------|------|
| G1 | AI 趋势演示文稿 | 研究→PPT | M5 | none | 文件链接 | 生成管线 |
| G2 | 竞品 PDF 报告 | 对比→PDF | M5 | none | PDF | 生成管线 |
| G3 | 长文转 Podcast | 文→音 | M5 | none | 音频 | 非浏览器核 |
| G4 | 市场图表报告 | 数据→图报告 | M5 | none | 报告 | 图表 |
| G5 | SaaS 定价工作簿 | 定价页→Excel | M2 可先 CSV | partial | 表/CSV | Excel 可选 |
| G6 | LinkedIn 转简历 PDF | 资料→PDF | M5 | none | PDF | 登录墙 |
| G7 | PH 发布工具包 | 分析→文案包 | M4 | none | MD 包 | — |
| G8 | 社交发布文案草稿 | 产品页→5 角度 | M4 | none | 草稿 | — |

### Operate（6）

| ID | 标题 | 能力簇 | 里程碑 | 持节状态 | 验收锚点 | 缺口 |
|----|------|--------|--------|----------|----------|------|
| O1 | 演示表单自动填写 | 填表+**提交前停** | M3 | partial | 015/G1 表单路径；批准卡 | 演示化、人话步骤 |
| O2 | 日历事件创建器 | 外写日历 | M3+ | none | 多事件创建 | 日历集成/权限 |
| O3 | 试用版引导准备 | 多站填+提交前停 | M3 | partial | 同 O1 多站 | 跨站会话 |
| O4 | 航班方案邮件 | 搜+比+邮件 | M2+M4 | none | 方案+草稿 | — |
| O5 | G2 评论汇总 | 读评+邮件 | M2+M4 | none | 优缺点+草稿 | — |
| O6 | 公寓搜索邮件 | 列表比+邮件 | M2+M4 | none | 推荐邮件 | — |

### 持节 T0 探针（015，非 Claw 目录但必过）

| ID | 句 | 里程碑 | 状态 |
|----|----|--------|------|
| J-CLOSE-* | 关页 | M1 | partial（代码有；live 待 Owner） |
| J-PLAY/PAUSE/CONT | 播停连续控 | M1 | partial |
| J-EXTRACT-01 | 当前页抓取 | M2 | none/partial |
| J-DL-* | 下载分档 | 后置 jarvis plan | partial stub |

---

## 与 bake-off（013）关系

- 013：执行核对打的通用 18 任务。  
- 015：贾维斯 T0 冻结句。  
- **016：产品对标 Claw 的故事矩阵与里程碑。**  
- plan TODO 12：把 M1/M2 关键句并入 013 扩表时，引用本表 ID（R1、O1…）。

## 更新纪律

1. 改案例标题以 Sider 落地页为准；我方验收句另开 015 风格冻结句时写「映射自 R1」不改对方营销字。  
2. 状态升级必须有：测试绿 和/或 reports 路径；禁止口头 `live`。  
3. M-80 宣称前：M0–M4 每簇至少一个 `ready` 故事 + TSR 闸门（013/015）。

## 当前优先（工程）

1. M0：design/005 落地（close_tab 文案 ✅；完成成果区、页内条可排期）  
2. M1：015 T0 live  
3. M3：O1 路径演示化（已有审批；Claw 录屏确认「填完不提交、等确认」）  
4. M2：extract + CSV/表成果链接（解锁 R 大半）  

## Sisyphus 视频补强（2026-07-23）

本地视频：`docs/product/research/sider-claw/videos/`（form-autofill / article-summary / ai-trend-ppt / competitor-pdf / amazon-price / hero-loop）。  
帧：`frames/`（约 50+）。  
报告同目录 research 016（含 30/30 mp4 hash 映射）。

关键产品结论：

| 发现 | 对持节 |
|------|--------|
| O1 明确「不点提交、等确认」 | M3 演示卖点，对齐批准卡 |
| G1/G2 PPT/PDF 靠侧栏脚本生成文件，浏览器只做研究 | **M5 默认不进 M-80**；勿把文件工厂当 Phase 1 浏览器核 |
| 完成 = Sheet/Docs/文件卡链接 | P4 成果区 |
| 步骤含 Browser/Bash log | 学可见与可停；文案走 design/005 人话 |
