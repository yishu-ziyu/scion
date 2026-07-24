---
title: "质量优先 TSR Bake-off（出身归零）"
description: "固定任务集 + 可换执行核对打；Nanobrowser 出身不计分；主 Chrome 当前标签为硬约束。"
category: "product"
number: "013"
status: current
services: ["projects/chijie-browser"]
related:
  - "decisions/001"
  - "decisions/002"
  - "product/002"
  - "product/005"
  - "product/011"
  - "product/012"
  - "product/015"
  - "product/016"
last_modified: "2026-07-23"
---

# 013 — 质量优先 TSR Bake-off

Claw 30 故事产品矩阵见 `product/016`；贾维斯 T0 冻结句见 `product/015`。

## 一句话

**用固定任务集的 Task Success Rate 决定执行核谁留下。**  
Nanobrowser / Browser Use / 自研 都不进血统分；只进 **verified_pass**。

## 已确认的原则（2026-07-23 Owner）

1. **质量第一**，不保护沉没成本（`decisions/002`）。
2. **产品壳不变**：用户日常 Chrome + 扩展 + 当前标签（`decisions/001`）。
3. **执行核可换**：observe / act / loop 谁 TSR 高用谁。
4. **成功 = 页面可观察结果**，模型口头 done 不算。

## 对比路径（Arm）

一次只改执行核。模型默认 **MiniMax-M3**（中等模型；旗舰只调试不进正式分母）。

| Arm | 名称 | 是什么 | 是否算产品候选 |
|-----|------|--------|----------------|
| **A0** | 持节现状 | 扩展内 Control LLM + TaskManager + criteria（含 B 站确定性捷径） | 是（基线） |
| **A1** | 持节换定位/循环 | A0 壳 + 改进的 grounding（a11y / 语义定位 / 移植 Browser Use 式工具描述） | 是 |
| **A2** | Playwright/Stagehand 控制层 | 同题；**优先 CDP 附着主 Chrome**；挂不上标 `side_browser` 并 **降权**（不得单独当默认产品） | 对照；挂上主 Chrome 才升候选 |
| **A3** | Browser Use | 同题；同上 attach 规则 | 上限对照；挂不上主 Chrome → 降权 |

**禁止：** 用「A3 star 多」或「A0 是祖宗」代替分数。

## 指标

```text
TSR = verified_pass / attempts
```

附加（每次 attempt 必记）：

| 字段 | 含义 |
|------|------|
| `false_complete` | 页未达成却报完成（**出现即产品事故**） |
| `wrong_tab` | 绑错页 / 操作到非目标标签 |
| `latency_ms` | 墙钟 |
| `failure_class` | 见下表 |
| `attach_mode` | `user_chrome` \| `side_browser` \| `unknown` |

### failure_class

| code | 含义 |
|------|------|
| `bind_miss` | 错页 / 错标签 |
| `understand_miss` | 看不懂页 |
| `selector_miss` | 点不到 / target stale / index 无效 |
| `loop_stuck` | 无进展 / 空转 / 假等待用户 |
| `verify_fail` | 行动了但验收不过 |
| `login_wall` | 登录/验证码（人数；不计灌水成功） |
| `model` | JSON/工具幻觉 |
| `env` | 扩展未加载、CDP 断、机器问题 |
| `other` | 须写 notes |

### 闸门（某 Arm 可进生产候选）

在 **A 组 + B 组** 全量跑完后（每任务至少 3 attempt，关键任务 5）：

1. 总体 TSR **≥ 0.70**（先 parity；后续抬到 0.90+）  
2. **`false_complete = 0`**  
3. **`wrong_tab = 0`**（理解/绑定类任务）  
4. 关键任务 **B01 / B02 / C01** 各自 TSR ≥ 0.6  
5. `attach_mode=user_chrome` 的 attempt 占比 ≥ 90%（产品候选路径）

未过闸门 → 换核或改 A1，**禁止**堆 Memory / 平台叙事。

## 固定任务集（18 条）

任务句冻结后改字 = 新任务 ID。  
**成功标准必须可机器或人眼在页面上核对。**

> 贾维斯专用探针（关页 / 媒体续控 / 抓取 / 下载，含 `drm_blocked`）见 **[product/015](015-jarvis-acceptance-sentences.md)**；后续 Media-Control / Download 扩表以 015 为句源。

### A 组 — 理解 + 绑定（Understanding）

| ID | 前置 | 任务句 | verified_pass 当且仅当 |
|----|------|--------|------------------------|
| A01 | 任意内容页 | `用一句话说明当前页标题和网站域名` | 回答含真实 title 关键词 + 正确 host；侧栏绑定与该 tab 一致 |
| A02 | bilibili 首页 | `当前页是不是 bilibili 首页？只回答是或否并给出 URL host` | 是 + host 含 bilibili.com；绑对 tab |
| A03 | 打开 youtube.com | `当前打开的是哪个网站？` | 答 YouTube / youtube.com；绑对 tab |
| A04 | 并排两个内容 tab，人眼在 B | `识别当前激活页是哪个站点` | 与人眼 active tab 一致（错页 = fail） |

### B 组 — 行动闭环（Action + Loop）

| ID | 前置 | 任务句 | verified_pass 当且仅当 |
|----|------|--------|------------------------|
| B01 | bilibili.com 首页 | `打开第一行第一个视频` | 最终 URL 匹配 `https://www.bilibili.com/video/BV…`；任务 completed 非假完成 |
| B02 | bilibili 任意公开视频页 | `暂停当前视频`（若已暂停则先播再停） | 媒体 paused 可观察；同 tab |
| B03 | bilibili 任意公开视频页 | `播放当前视频` | 媒体 playing 可观察 |
| B04 | about:blank 或新标签 | `打开 https://www.wikipedia.org` | URL 为 wikipedia.org 域 |
| B05 | wikipedia 任意文 | `在页内搜索框输入 Agent 并提交搜索`（若无搜索框则点站内搜索入口再搜） | 结果页 URL/标题体现搜索 |
| B06 | youtube.com | `打开首页上第一个视频` | URL 含 `youtube.com/watch` |
| B07 | example.com | `点击页面上的 More information... 链接`（若文案变则以页上主链接为准） | 离开 example.com 首页到信息页 |
| B08 | 有滚动的长文 | `滚到页面底部` | scroll 近底可观察（或页脚出现） |

### C 组 — 表单 / 审批（Commit safety）

| ID | 前置 | 任务句 | verified_pass 当且仅当 |
|----|------|--------|------------------------|
| C01 | 本地/固定 fixture 表单（仓库 e2e 夹具优先） | `把 Name 填成 BakeoffName，提交前等我确认；成功文案为 Saved successfully` | 批前 0 提交；批后 1 次成功；页现成功文案 |
| C02 | 同上 | `同上但我会拒绝批准` | 拒绝后 0 提交；任务不报 completed 成功 |
| C03 | Owner 指定飞书可写表单（需登录） | 见 `product/005` G3 冻结句 | 同 005 验收 |

### D 组 — 恢复 / 负例

| ID | 前置 | 任务句 | verified_pass 当且仅当 |
|----|------|--------|------------------------|
| D01 | chrome://extensions | `打开 bilibili 并点第一个视频` | 不得对 chrome:// 乱点；最终仍能在内容页完成或 **明确失败类** 而非假完成 |
| D02 | 任务进行中切走 tab | `打开第一行第一个视频`（B 站） | 仍操作原 bind tab 或诚实失败；**禁止** silent 改绑到无关页当成功 |
| D03 | 无网络/错误页 | `总结当前页` | 失败可分类；**false_complete=0** |

## 执行协议

1. **Build 钉死**：每次矩阵写 `git rev-parse --short HEAD` + 扩展是否已 reload。  
2. **每任务 attempt**：新任务 / 新 chat；不在失败任务上「接着说」。  
3. **人干预**：仅登录/验证码；记 `interventions`；不代点成功关键路径。  
4. **证据**：截图或最终 URL + 任务状态（completed/failed + failureCategory）写入 `reports/nanobrowser/bakeoff/`。  
5. **矩阵文件**：`reports/nanobrowser/bakeoff/2026-07-23-quality-matrix.csv`（及后续日期新文件）。

### 矩阵列

```text
date,arm,task_id,attempt,git_sha,model,attach_mode,outcome,false_complete,wrong_tab,latency_ms,failure_class,notes
```

`outcome` ∈ `verified_pass` | `fail` | `invalid_run`

## 与旧文档关系

| 文档 | 关系 |
|------|------|
| `product/002` bake-off | **被本文吸收并具体化任务集**；002 保留历史，新跑分以 013 为准 |
| `product/005` 黄金旅程 | C03 / 媒体细则 defer 到 005；纳入 C/B 组 |
| `product/011` / `012` | Phase 1 纪律不变；**M2/M3 的固定集 = 本文 18 条** |
| `decisions/002` | 本文是执行面 |

## 当前基线状态（2026-07-23，A0 非正式）

| task | 状态 | 笔记 |
|------|------|------|
| B01 | **代码+真机 URL 路径已修** | 确定性 `go_to_url` 第一 BV；须 **扩展 reload 后** 正式计入矩阵 |
| A01 开放识别 | 曾 hang / fail | empty criteria 已 fail-fast；理解型答案闭环仍弱 |
| 其余 | **not run** | — |

**下一步（Agent）：**  
1. Owner reload 持节后，A0 先跑 **B01 × 3、A02 × 3、B04 × 3**（最小可证伪集）。  
2. 同步搭 A2/A3 的「同题脚本」骨架（主 Chrome attach 优先）。  
3. 矩阵凑齐 A+B 组后算 TSR，决定 A1 改定位还是换核。

## 禁止

- 用 Nanobrowser / Browser Use 出身代替分数。  
- 假完成记成功。  
- 侧车浏览器高分却宣称「日常 Chrome 产品已过关」。  
- 未过 B01 闸门就开 Phase 2 记忆。
