---
title: "Sider Claw 示例全目录 + 交互视觉拆解（对标持节）"
description: "基于 sider.ai/zh-CN/agents/claw 落地页 30 个演示：完整 mp4 映射、多案例帧级 UX、FAQ、能力分类与持节 80% 对标缺口。"
category: product-research
status: current
owner: sisyphus-research
researched_at: "2026-07-23"
source: "https://sider.ai/zh-CN/agents/claw"
related:
  - product/011
  - product/014
  - product/015
  - product/016
  - design/005
  - decisions/003
---

# Sider Claw — 示例目录与 UX（持节对标）

## 0. 证据说明

| 项 | 内容 |
|----|------|
| 主源 | https://sider.ai/zh-CN/agents/claw （Playwright 实开，点击 30 案例 modal 抓 mp4） |
| 案例数 | **30**（研究 8 + 转换 8 + 生成 8 + 操作 6） |
| 视频 URL | **30/30 已映射**（`pub-cdn.sider.ai/static/resources/main/_next/static/<hash>.mp4`） |
| 本地下载 | 5 条完整 demo + hero 循环；帧序列见 `frames/` |
| 帧拆 | Amazon（约 8s×8）、form-autofill / article-summary / ai-trend-ppt / competitor-pdf（约 4–8s） |
| 交叉文档 | 验收矩阵 `product/016`；UX 原则 `design/005` |
| 限制 | 录屏是营销剪辑后的「真实任务感」演示，非线上 A/B 统计；对比表「支持/部分/不支持」来自落地页图标，未逐格 OCR |

本地资产：

```text
docs/product/research/sider-claw/
  videos/
    amazon-price.mp4       # R1  67s
    form-autofill.mp4      # O1  23s
    article-summary.mp4    # T1  32s
    ai-trend-ppt.mp4       # G1  43s
    competitor-pdf.mp4     # G2  37s
    hero-loop.mp4          # 落地页主循环
  frames/
    amazon-*.jpg
    form-autofill-*.jpg / form-autofill-d*.jpg
    article-summary-*.jpg / summary-d*.jpg
    ai-trend-ppt-*.jpg / ppt-d*.jpg
    competitor-pdf-*.jpg / pdf-d*.jpg
```

---

## 1. 他们卖的产品体验（一句话）

**一次请求 → 步骤在侧栏可见 → 浏览器真动 → 交付可直接用的成果（表 / 文档 / 草稿 / 文件），不是又一堆标签页。**

落地页三步：

1. **描述任务** — 研究、比较、提取、监控或重复浏览器工作流，用自己的话  
2. **观看 Claw 工作** — 打开页、读内容、跟链接、比较来源；**每一步实时可见**  
3. **查看结果** — 表格、摘要、报告、草稿或建议  

口号：**一次请求。步骤可见。结果即成。**

技术叙事：基于 **OpenClaw**；**真实浏览器会话**；可配合 **可观测云浏览器**；Chrome / Edge。

社会证明文案：1000 万+ 活跃用户 / 10 万+ 五星 / TOP 30 OpenAI 合作伙伴（营销口径，未独立核验）。

### 1.1 场景定位（四卡片）

| 场景 | 文案要点 |
|------|----------|
| 跨站点调研 | 比较列表、评价、竞品，无需手动复制 |
| 提取并整理 | 价格、规格、联系人、声明、评论、排名 → 表与可复用文件 |
| 生成交付成果 | 杂乱浏览 → 摘要、报告、建议 |
| 运行工作流程 | 检查页面、收集更新、准备每周产出 |

### 1.2 对比表（落地页声称）

相对「Chrome 中的 Claude / Gemini」，Sider 自称全支持：

- 在现有浏览器中运行  
- 使用已登录会话  
- 跨网站、多标签页任务  
- **专属云端电脑**  
- **跨会话记忆**  
- **生成多种格式文件**  
- 支持多模型  

（图标级声明；持节不默认云电脑，见 decisions/001。）

### 1.3 工作环境四条

| 标题 | 卖点 |
|------|------|
| 你的真实浏览器 | 站、标签、上下文都在日常 Chrome/Edge |
| 已登录的网站 | 用当前会话，关键操作可见可审 |
| 跨网站任务 | 切换、比较、提取、整理 |
| 可直接使用的成果 | 表 / 摘要 / 报告 / 草稿 / 文件，不只聊天回答 |

---

## 2. 全目录 30 例 + mp4 映射

CDN 基址：`https://pub-cdn.sider.ai/static/resources/main/_next/static/`  
下列 `hash.mp4` 拼接即可下载。点击落地页案例卡片会打开 modal 自动播放同一 URL。

### 2.1 研究 Research（8）

| ID | 标题 | 用户意图 | 时长 | mp4 hash |
|----|------|----------|------|----------|
| R1 | Amazon 价格追踪 | 热门列表抽价格/评分/评论数 → 表格 | 01:07 | `0372d719536bb38f32588ced4989230b` |
| R2 | 竞争性 SEO 洞察 | Ahrefs 竞品关键词/热页/外链/缺口 | 02:24 | `7e60b46482a2b01537b10ce548572e01` |
| R3 | 招聘信号简报 | 竞品招聘页 → 人才战略简报 | 01:02 | `b8fc29a436afa66d3e992a9667e2068b` |
| R4 | 评论痛点挖掘 | 低星评论聚类 → 产品痛点 | 00:51 | `434eecef954d9cd3e29b7609a201fcc4` |
| R5 | Reddit 话题扫描 | 多 sub 热帖 → 内容创意清单 | 01:00 | `41cb100fb3070ebb64126d6b48850e25` |
| R6 | YouTube 话题调研 | 热门视频元数据 → Sheets | 00:53 | `44242546ec6885541e62949c80a40615` |
| R7 | 活动情报表 | 多站日期/地点/票价 → 一表 | 00:51 | `686c087dce5ec5e5be35d0c45d3a3319` |
| R8 | 公司联系方式采集器 | 联系页邮箱/电话/地址 → 表 | 01:17 | `532fbe2566dedc7bdb25c3f351cfbbe7` |

### 2.2 转换 Transform（8）

| ID | 标题 | 用户意图 | 时长 | mp4 hash |
|----|------|----------|------|----------|
| T1 | 文章摘要文档 | 英文文 → 中文结构化商业摘要 Docs | 00:32 | `99a66484ee5b7cd662d3da8a1cce0008` |
| T2 | AI 趋势简报 | 新闻 → 高管趋势简报 | 00:37 | `a30a220baf27eec36d3902500f415692` |
| T3 | 报告转邮件草稿 | 行业文 → 团队邮件+行动项 | 00:28 | `311dd3d950144f0e9c4063223f62c895` |
| T4 | 课程推荐 | 跨平台比课 → 推荐邮件 | 01:01 | `ce1069587d44623cb31ca99985088b5d` |
| T5 | 邮件主题创意 | 主题行示例 → 灵感清单 | 00:44 | `22b92e557ce641fcbdede9058520837e` |
| T6 | 演讲者资料表 | LinkedIn 等 → 嘉宾调研表 | 00:35 | `edd1f8e9d44ef77532ad4dd508ca338b` |
| T7 | 新闻通讯来源清单 | 找 newsletter → 主题/频率/链接表 | 00:45 | `a77a236c444f227d3e19636cbdb3afd6` |
| T8 | 网站改版提案 | 主页+参考 → 改版提案框架 | 00:57 | `1b2ddef3d14e523af483919f8c2a4ead` |

### 2.3 生成 Generate（8）

| ID | 标题 | 用户意图 | 时长 | mp4 hash |
|----|------|----------|------|----------|
| G1 | AI 趋势演示文稿 | 研究 → 10 页 PPT | 00:43 | `372efbfc3608bdeaf0ac9baa1aad59cc` |
| G2 | 竞品 PDF 报告 | 工具对比 → 可下载 PDF | 00:37 | `c30d75408345548b42e2e0e1ea5f6fe8` |
| G3 | 长文转 Podcast | 长文 → 双主持人脚本+音频 | 00:32 | `5ac2265fd8a5ac78637d843048d975ab` |
| G4 | 市场图表报告 | 多源数据 → 可视化增长报告 | 00:38 | `3d40687a13617f647a26ba75c349ebc4` |
| G5 | SaaS 定价工作簿 | 定价页 → Excel | 00:31 | `cc99cb084b9fa9fcb66e76060824a158` |
| G6 | LinkedIn 转简历 PDF | 公开资料+模板 → PDF 简历 | 00:38 | `d131a80634bab6e48579a26ab0141d04` |
| G7 | Product Hunt 发布工具包 | 热门发布 → 发布页工具包+社媒角度 | 00:33 | `6d7545b6d4e4f206a30111e034383e78` |
| G8 | 社交发布文案草稿 | 产品页 → 5 条社媒角度 | 00:40 | `c89ec8da123e65eece10c8f32b9855c6` |

### 2.4 操作 Operate（6）— 最像「贾维斯动手」

| ID | 标题 | 用户意图 | 时长 | mp4 hash |
|----|------|----------|------|----------|
| O1 | 演示表单自动填写 | Salesforce 演示表 → **提交前暂停** | 00:23 | `235e4b230a5b98edd7276ac20765b844` |
| O2 | 日历事件创建器 | 一条提示 → 多个日历事件 | 00:51 | `c9a16ff296d5d3245b2b5df1f0de0992` |
| O3 | 试用版引导准备 | 多 SaaS 注册引导字段 → **最终提交前停** | 00:54 | `0f1ea9d117594ff225d4511027206e5c` |
| O4 | 航班方案邮件 | 找便宜机票 → 推荐邮件 | 00:42 | `aa94375cfaabb3df3c35830d58d98d9e` |
| O5 | G2 评论汇总 | 优缺点 → 对比邮件 | 01:06 | `47ff9b111c3ec84cead8def221bf9ea9` |
| O6 | 公寓搜索邮件 | 租房比较 → 推荐邮件 | 00:29 | `cebfb2f947ddb8c00c32e865a00e1dfc` |

另：落地页 hero 循环视频 hash `57f8810ff7576c68ff48f51ac61a4cde`；另有营销全片引用 `https://sider.ai/videos/siderclaw-full-demo.mp4`（未作为案例卡）。

---

## 3. 能力分类（taxonomy）

30 例不是 30 个功能，是 **同一 Agent 环** 上的四类结果形态：

| 能力簇 | 案例 | 用户可见终点 | 浏览器动作要点 |
|--------|------|--------------|----------------|
| 多站导航 + 列表/详情抽取 + 写表 | R1 R4 R6 R7 R8 | Sheets / 表 | 搜索、开详情、滚动、结构化字段 |
| 登录站只读调研 | R2（Ahrefs） | 对比洞察 | 真会话附着 |
| 社媒/招聘情报 → 简报 | R3 R5 T6 | 简报/清单 | 列表聚合 |
| 读正文 → 文档（跨语言） | T1 T2 T8 | Docs / MD | 读页 + 新开编辑器 + 打字写入 |
| 读页 → 邮件草稿 | T3 T4 O4 O5 O6 | 邮件/可复制草稿 | 搜比 + 生成文案 |
| 收集清单类 | T5 T7 | 表/清单 | 轻量多站 |
| **生成重文件** | G1 PPT G2 PDF G5 Excel G6 PDF | 可下载文件卡 | 研究环 + **Bash/脚本/本地生成** |
| 文→音 | G3 | 脚本+音频 | 非纯浏览器核 |
| 数据可视化报告 | G4 | 报告 | 多源 + 出图 |
| 文案工具包 | G7 G8 | MD/草稿包 | 分析 + 写作 |
| **填表 + 提交前停** | O1 O3 | 表单就绪、不点提交 | 原生点击/输入/下拉；**人工确认门** |
| 日历外写 | O2 | 多事件创建 | 写操作 + 权限 |

持节里程碑映射（见 `product/016`）：

| 簇 | 默认里程碑 |
|----|------------|
| 基础附着 + 可见步骤 + 停止 | M0 / M1 |
| Research 抽表 | M2 |
| Operate 填表提交前停 | M3 |
| Transform 文档/邮件 | M4 |
| Generate PPT/PDF/音视频 | M5（默认不挡 M-80） |

---

## 4. 视频里用户看见什么（Presentation notes）

### 4.1 统一壳（所有已拆帧 demo 共性）

```text
┌──────────────── 主 Chrome 内容区 ────────────────┬── 右侧 Sider 侧栏 ──┐
│ 真实站点（Amazon / Salesforce / Docs / Asana…）   │ 任务原文（用户 prompt）│
│ 多标签；地址栏真实 URL                             │ 步骤时间线（工具感）    │
│ 页底浮层：「Claw is operating this page」          │ Stop generating        │
│ 顶栏偶见：「Sider Operator started debugging…」   │ 底部可继续输入          │
│                                                   │ 完成：叙述 + 文件/链接   │
└──────────────────────────────────────────────────┴──────────────────────┘
```

侧栏垂直应用条常见：Chat / **Claw**（紫高亮）/ Code / REC Note / Agent / Create / Translate / Write / More。  
模型条：`Chat with all AI: GPT-5, Claude, DeepSeek…`（营销聚合）。  
运行中：`Stop generating`；底部 `Enter your thoughts…`（连续控制）。  
Max 档位可见（套餐暗示）。

**页内操作条（Claw 标志 UX）：**

- 主内容区底部居中胶囊：`Claw is operating this page` + 小方块指示  
- 部分场景顶部条：`Sider Operator started debugging this browser` + **Cancel**  
- 标签上有时出现粉色/高亮「正在操作」类标签标题（截断的 prompt）

### 4.2 R1 Amazon 价格追踪（`amazon-*.jpg`）

时序：

```text
用户 prompt（搜 ultrasonic aromatherapy diffuser，前 5 条 → Google Sheet）
  → 读 SKILL.md / get skill
  → 开 Amazon 搜索结果（页内 Claw operating）
  → 逐商品 Extract product N + navigate 详情
  → 新开 Google Sheets 空白表
  → 写入 Title / Price / Star Rating / Number of Reviews
  → Done + Sheet URL + 校验句（5 行已写）
```

**成果定义：** Sheet 里有行，不是「聊天说完了」。  
步骤文案偏工具日志：`Browser: open` / `Extract product 3` / `navigate`。

### 4.3 O1 演示表单自动填写（`form-autofill-*.jpg`）

用户 prompt 要点（演示故意写死安全策略）：

- 打开 Salesforce demo 表  
- 填齐字段  
- **不要点 Submit**；说「All fields are filled — ready to submit」并等确认  
- **必须原生浏览器交互**（点、打字、下拉），禁止 web_fetch / 后台工具

时序：

```text
sider.ai/chat 主页 + 侧栏贴好完整任务
  → 新标签打开 salesforce.com/.../request-a-demo/
  → Thought process / Read SKILL.md / Browser: open
  → 字段逐步填入（First/Last/Job/Email/Company/Employees/Mobile/Country/State）
  → 勾隐私协议；绿勾出现在已填字段
  → 仍停在 REQUEST A DEMO 按钮前（不点）
```

**产品含义：** 「敢动手」+「提交门」是同一卖点。  
持节 external commit 审批与此同构；演示化程度是差距。

### 4.4 T1 文章摘要文档（`article-summary-*.jpg`）

```text
OpenAI o3/o4-mini 英文发布页
  → 侧栏：读文 → 中文结构化商业摘要 → 写入 Google Docs
  → 新开 Docs 空白文档（Claw operating）
  → 用中文标题与三级结构打入正文
  → 侧栏同步给出板块大纲（核心论点 / 关键发现 / 业务相关）
```

**成果：** Docs 里可读的中文摘要 + 侧栏结构回执。  
混用：`Web_fetch` + 浏览器写 Docs（演示里出现过 fetch 工具，与 O1「禁止 fetch」策略因任务而异）。

### 4.5 G1 AI 趋势演示文稿（`ai-trend-ppt-*.jpg` / `ppt-d*.jpg`）

```text
用户：搜 AI agents 2026 趋势 → 10 页 PPT → 存文件
  → Google → 点进 Firecrawl 等文章
  → 侧栏：navigate / Extract 文章 / **Bash python-pptx** / Edit create_pptx.py
  → 交付 AI_Agent_Trends_2026.pptx 文件卡
  → Slide breakdown 表（10 页目录）
  → 成品幻灯片全屏（暗色商业模板：趋势标题 + KEY INSIGHTS + 案例）
```

**关键：** 浏览器只负责研究；**PPT 由本地脚本生成**。  
侧栏出现 `Bash`、`Edit`、路径型工具痕迹 — 对用户是「文件掉下来了」，对工程是 **agent + 代码执行沙箱**，不是纯 DOM 操作。

### 4.6 G2 竞品 PDF 报告（`competitor-pdf-*.jpg`）

```text
prompt：搜 2026 创业项目管理工具 Top3 → 访官网 → 抽功能/定价/免费档/受众 → PDF
  → 建议 chips 冷启动（定价对比、Scholar、HN…）
  → 访 Asana 等定价页
  → 侧栏预告 PDF 目录结构（Cover / Deep-dive / Head-to-head / Recommendations）
  → Bash：python generate_report.py + ReportLab
  → 本地 PDF 在 Chrome 打开；侧栏文件卡 + step-by-step 完成叙述
  → 页脚可见 OpenClaw Research 字样
```

**成果：** 可下载 PDF + 完成检查清单。  
同样是 **研究环 + 文件生成管线**。

### 4.7 步骤与工具呈现（跨 demo）

| 可见元素 | 用户解读 | 持节应对（design/005） |
|----------|----------|------------------------|
| `Browser: open/navigate/Extract…` | 在干活 | 映射为人话：打开页面 / 读取列表 |
| `Read SKILL.md` / `get skill` | 有技能加载 | 不对用户露文件名 |
| `Thought process` | 在想 | 可折叠或不主展示 |
| `Bash` / `Edit *.py` | 在造文件 | M5 才需要；主 UI 只说「正在生成 PDF」 |
| 文件卡 `.pptx` / `.pdf` | **结果即成** | 完成区必须可点开 |
| Stop generating | 我能停 | 停止永远在 |
| Claw operating 浮层 | 这页在被控 | 冷静中文条，无工具名 |

---

## 5. FAQ（落地页全文）

| 问 | 答 |
|----|-----|
| 什么是 Sider Claw？ | 在你浏览器中运行的 AI 浏览器代理。交给它一个任务，就能在你已使用的网站上调研、比较、提取、整理并生成结果。 |
| 它最适合哪些类型的任务？ | 多步骤浏览器工作：研究、比较、提取、监控、报告准备、表格创建，以及重复性网页工作流。 |
| 我可以看到 Sider Claw 正在做什么吗？ | 可以。围绕可见浏览器操作构建 — 可一步步跟踪进度、查看发现，全程保持掌控。 |
| 它能在我已登录的网站上使用吗？ | 可以。在你自己的浏览器中运行，使用当前已登录会话 — 无需单独设置，也无需共享凭据。 |
| 它会在未经我批准的情况下执行操作吗？ | 执行过程始终展示步骤，重要操作可供审核，可随时介入。浏览器中发生的一切由你掌控。 |

**产品读法：** FAQ 把三件事钉死 — **可见性、登录态、批准门**。  
与 O1/O3「提交前停」演示一致；与持节审批卡叙事一致。

---

## 6. 「复刻 80%」怎么理解 + 持节缺口

不是 30 个独立功能打勾，而是：

1. **同一可执行环** 覆盖 Research / Transform / Generate / Operate 四类故事  
2. **用户感知三件套**：侧栏步骤可见、主窗真操作（+页内条）、可交付成果  
3. **安全默认**：外写 / 提交前可审  

### 6.1 与 `product/016` 里程碑对齐

| 里程碑 | 用户侧含义 | 相对 30 例 | 持节现状（矩阵码，随实现更新） |
|--------|------------|------------|--------------------------------|
| M0 UX 壳 | 人话步骤、停止、完成句、页内条 | 全部案例的「看得见」 | 原则在 design/005；实现渐进 |
| M1 Parity 环 | 附着 + observe-act + 证据完成 | 基础，非 30 全文 | partial |
| M2 Research 表 | 多站读 + 结构化 + 表/CSV | R 类主形态 | partial（R1/R6 等） |
| M3 Operate-safe | 填表 + **0 未批提交** | O1 O3 核心 | partial（有审批，演示化不足） |
| M4 Deliverable | 摘要/邮件/本地文档链接 | T 类 + 部分 G/O | none 为主 |
| M5 File pack | PPT/PDF/Excel/音视频 | G 类重文件 | none；**默认不挡 M-80** |
| **M-80** | M0–M4 + 固定集 TSR | 用户口径约 80% | 未宣称 |

### 6.2 能力缺口（工程向，对照演示证据）

| 演示里用户得到的 | 持节若要对齐需要 | 优先级 |
|------------------|------------------|--------|
| 页内 `Claw is operating this page` | content script 冷静浮层（design/005 P3） | M0 |
| 侧栏逐步 Browser 动作（虽糙） | 人话步骤流，禁 presentation leakage | M0 |
| 完成 + **Sheet/Docs/文件链接** | 完成区成果链接 / 下载项 | M2–M4 |
| 多 tab 研究 + 列表抽取写表 | extract 产品化 + 多 tab 调度 | M2 |
| 填表绿勾 + 提交前停 | 演示路径 + 批准卡默认 | M3 |
| 中文摘要写入 Docs | 正文抽取 + 导出/剪贴板/本地 MD | M4 |
| PPT/PDF 文件卡 + Bash 生成 | 文件生成管线或后置 | M5 |
| 登录站 Ahrefs 等 | 真会话只读策略 + 失败可解释 | M2 难例 |
| 云电脑 / 跨会话记忆 | **非 Phase 1**（parity-first 明确后置） | Phase 2+ |
| OpenClaw 沙箱 + python-pptx/ReportLab | 可选 helper，不进默认「会走路」 | M5 |

### 6.3 持节应 **学** 与 **不学**

**学（用户可见）：**

1. 一次自然语言目标驱动全链路  
2. 运行中永远可停、可补充  
3. 页内「正在操作」+ 侧栏步骤双通道  
4. 完成 = 可打开成果，不只绿勾  
5. 危险写操作默认提交前停（演示话术即产品话术）  
6. 冷启动建议 chips  

**不学 / 要更干净：**

1. 主 UI 堆 `Browser:` / `Bash` / `SKILL.md` / 路径  
2. 默认云电脑与跨会话记忆当 Phase 1 主叙事  
3. 用重文件生成掩盖「浏览器操作不稳」  
4. 假百分比进度  

### 6.4 诚实结论

- **Parity 80%（持节自定 M-80）** ≈ M0–M4 各至少一条 `ready` 故事 + TSR，**不含**必须齐 G1–G6。  
- 若有人把「30 例逐条复刻」叫 80%，那是 **营销目录完成度**，不是 Phase 1 质量定义；应拆开讲。  
- 当前离 M-80：环与审批有底座，**抽表成果链接、文档交付、页内条、O1 演示化** 是最短路径；PPT/PDF 是锦上添花。

---

## 7. 持节 UX 可直接借的清单（不抄壳）

对应 `design/005`，本调研补充证据：

1. **页内「正在替你操作此页」** — 已在多 demo 证明是 Claw 识别符号  
2. **完成区必须有可点成果** — Sheet / Docs / `.pptx` / `.pdf`  
3. **Stop 永远在 + 运行中 composer 可输入**  
4. **任务建议 chips**（冷启动）  
5. **提交前暂停** 做成默认卖点（O1 明示写进 prompt）  
6. 步骤可见但 **比 Sider 更干净**（反 presentation leakage）  
7. 完成叙述可用「我做了什么」清单（G2 风格），但要人话、非工具 dump  

---

## 8. 落地页文案摘录（便于引用）

- H1：在浏览器中自动完成任何任务  
- H2：Sider Claw 基于 OpenClaw 打造，利用你真实的浏览器会话来完成复杂任务  
- 口号：一次请求。步骤可见。结果即成。  
- 案例区：未经剪辑的录屏 — 每个案例都从一个提示开始，以完整成果结束。  
- CTA：把你的下一个浏览器任务交给 Sider Claw / 添加到 Chrome  

---

## 9. 开放工作

- [x] 30 例标题 + 描述 + 时长 + **mp4 URL 全映射**  
- [x] FAQ 五问全文  
- [x] 跨 Tab 至少 4 条 demo 本地下载 + 帧拆（O1 / T1 / G1 / G2 + 既有 R1）  
- [ ] 可选：R2 长任务 / O2 日历 再拆帧（登录与外写边界）  
- [ ] 将帧级证据摘要回写 `product/016` 状态时引用本文件路径  
- [ ] Owner：是否把页内 operating 条排进最近 sprint（design/005 已原则冻结）  

---

## 10. 给 Owner 的结论

Sider Claw 落地页是 **同一 Agent 环的 30 个验收故事**，不是功能超市。  

用户真正买的三样：

1. **看得见**（侧栏步骤 + 页内条）  
2. **真的在动**（日常 Chrome 多标签）  
3. **结果即成**（表 / 文档 / 文件可点开）  

外加默认：**危险操作先问我**。  

持节对齐路径：壳继续安静任务台（design/004）；**环与交付物**按 `product/016` M0→M4 收敛到这些故事；文案比对方更干净。  
**不要**用 PPT/云电脑叙事代替「会走路」。
