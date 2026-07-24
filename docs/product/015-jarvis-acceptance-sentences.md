---
title: "贾维斯验收句（冻结）"
description: "浏览器贾维斯 Phase 1 固定自然语言任务句；每句含前置、verified_pass、failure_class；改字 = 新任务 ID。"
category: "product"
number: "015"
status: current
services: ["projects/chijie-browser"]
related:
  - "product/003"
  - "product/011"
  - "product/013"
  - "product/014"
  - "product/016"
  - "decisions/001"
  - "decisions/002"
  - "decisions/003"
last_modified: "2026-07-23"
---

# 015 — 贾维斯验收句（冻结）

## 一句话

**用户说什么、页上必须变成什么，写死在这里。**
改任务句文字 = 新任务 ID；不得边跑分边改字。

## 用途与边界

| 项 | 说明 |
|----|------|
| 用途 | 贾维斯计划 TODO 1 冻结句；T0 控制 / T1 下载 / T4 抓取的验收与 bake-off 扩表输入 |
| 产品 | 持节 / Chijie；`attach_mode=user_chrome` 为默认产品路径 |
| 与 013 | 013 是 18 条通用 bake-off；本文是贾维斯专用探针集，可并入 013 扩表（plan TODO 12） |
| 与 016 | Claw 30 例产品对标与里程碑；本文是 M1/T0 探针，016 管 R/T/G/O 故事矩阵 |
| 与 014 | **任务句是用户自然语言**，禁止夹带工程码、核名、`failure_class` 原文；工程码只出现在本表「评测列」与日志 |
| 成功定义 | 仅 `verified_pass`（可观察证据）；模型口头 done 不算；`false_complete = 0` |

## 冻结纪律

1. 下表「任务句」列是**唯一**用户输入文案（中文，一字不改）。
2. 前置由操作员/自动化准备；不写进用户句。
3. `verified_pass` 可机器核对优先，否则人眼 + 截图/URL/downloads 状态。
4. 侧栏对用户的失败文案须走 014 映射；评测 CSV 记内部 `failure_class`。
5. 正式分：中等模型默认 MiniMax-M3；每任务至少 3 attempt，关键任务 5。

---

## failure_class（贾维斯扩展）

继承 `product/013` 表，并**追加**下载/流相关码：

| code | 含义 | 用户侧（须映射，禁止原文） |
|------|------|---------------------------|
| `bind_miss` | 错页 / 错标签 / 错媒体对象 | 我好像不在你正在看的页面上 / 没对准那个视频 |
| `understand_miss` | 看不懂页或指令 | 没理解你要我做什么 |
| `selector_miss` | 点不到 / target stale | 没找对要点的位置 |
| `loop_stuck` | 无进展 / 空转 | 反复试了还是没进展 |
| `verify_fail` | 行动了但验收不过 | 还不能确认已经完成 |
| `login_wall` | 登录 / 验证码 | 需要你先登录 |
| `model` | JSON / 工具幻觉 | （内部；展示用「出了点问题，再试一次」类） |
| `env` | 扩展未加载、CDP 断、机器问题 | 插件或浏览器连接有问题 |
| `drm_blocked` | 商用 DRM / 不可保存的受保护流 | 这类受保护内容暂时保存不了 |
| `stream_not_found` | 当前页发现不到可下载媒体候选 | 这页上我还没找到能保存的视频 |
| `other` | 须写 notes | — |

**硬规则：**

- T3 DRM 页：必须 `drm_blocked`（诚实失败），**禁止**报下载成功。
- 无候选流却报「已下载」= `false_complete`（产品事故），正确类为 `stream_not_found` 或 `verify_fail`。
- 关错 tab / 控错媒体 = `bind_miss` 或记 `wrong_tab=1`，不得 verified_pass。

---

## 冻结任务集（J 组）

任务句冻结日：`2026-07-23`。
能力档对照 plan：T0 控制、T1 下载、T4 抓取（见 `.omo/plans/jarvis-browser-control.md`）。

### J-CLOSE — 关页（×2 变体）

| ID | 前置 | 任务句（冻结） | verified_pass 当且仅当 | 常见 failure_class |
|----|------|----------------|------------------------|-------------------|
| **J-CLOSE-01** | 至少两个内容 tab；人眼确认目标 tab 为**当前激活**页（非扩展页、非 chrome://） | `关掉这个页` | 该目标 tab 关闭；原并列 tab 仍在；侧栏任务 completed 且证据表明目标 tabId 消失；**未**关闭其他内容 tab | `bind_miss`（关错 tab）、`verify_fail`、`env` |
| **J-CLOSE-02** | 同上；激活页为任意内容页 | `关闭当前标签` | 与 J-CLOSE-01 同验收；仅措辞变体，绑定语义同「当前激活 tab」 | 同 J-CLOSE-01 |

**说明：** 两句都是「当前激活 tab」语义；用于防止只过一种口语。
若实现只认一种措辞，另一句 fail 须记 `understand_miss`，不得 silent 忽略。

### J-PLAY / J-PAUSE — 播与停

| ID | 前置 | 任务句（冻结） | verified_pass 当且仅当 | 常见 failure_class |
|----|------|----------------|------------------------|-------------------|
| **J-PLAY-01** | 公开可播视频页（优先 bilibili 公开视频或 fixture `<video>`）；媒体当前为 **paused**（若已在播则先人工/脚本暂停） | `播放当前视频` | 同 tab 内目标媒体可观察为 **playing**（元素 `paused===false` 或等价证据）；未跳到无关 tab | `bind_miss`、`selector_miss`、`verify_fail`、`login_wall` |
| **J-PAUSE-01** | 同上页；媒体当前为 **playing**（若已暂停则先播） | `暂停当前视频` | 同 tab 内目标媒体可观察为 **paused**；未关 tab、未换源冒充暂停 | 同 J-PLAY-01 |

### J-CONT — 「这个」连续控制

| ID | 前置 | 任务句（冻结） | verified_pass 当且仅当 | 常见 failure_class |
|----|------|----------------|------------------------|-------------------|
| **J-CONT-01** | 公开视频页；页上仅一条主媒体或主播放器明确；任务**同一会话连续两轮**（不可新开任务把第二句当地一次） | **Round 1：** `播这个`  **Round 2（媒体已 playing 后）：** `停这个` | Round 1 后同一 `target_digest`/媒体对象 playing；Round 2 后**同一对象** paused；两轮 `wrong_tab=0`；侧栏两轮均有可观察回执 | `bind_miss`（第二轮绑丢）、`verify_fail`、`loop_stuck` |

**说明：** 任务句两轮分别冻结；「这个」不得解析成另一个 tab 或页上广告位视频。
第二轮若 digest 丢失却乱点第一个控件 = fail。

### J-EXTRACT — 当前页抓取

| ID | 前置 | 任务句（冻结） | verified_pass 当且仅当 | 常见 failure_class |
|----|------|----------------|------------------------|-------------------|
| **J-EXTRACT-01** | 固定内容页（推荐 fixture 或 wikipedia 稳定一文）；人眼可见标题 + 至少一段正文 | `把这一页的标题和正文要点抓成一段话给我` | 输出含页上真实标题关键词 + 至少一条正文可见信息；回执或结果中带来源 URL 且 host 与当前 tab 一致；**非**编造他站内容 | `bind_miss`、`understand_miss`、`verify_fail`、`env` |

### J-DOWNLOAD — 下载（一句 + 负例类）

| ID | 前置 | 任务句（冻结） | verified_pass 当且仅当 | 常见 failure_class |
|----|------|----------------|------------------------|-------------------|
| **J-DL-01** | **T1 可下页**：直链 mp4/webm 或同源 `<video src>` fixture / 用户可「另存为」的 progressive 媒体；下载目录可观察 | `下载这个视频` | 触发本机下载且 downloads 状态 **completed**（或等价证据：路径 + 字节 > 0）；文件对应本页候选流；任务 completed 非假完成；若策略要求确认，批一次后完成 | `stream_not_found`、`verify_fail`、`login_wall`、`env`、`other` |
| **J-DL-DRM** | **T3 样例页**（已知商用 DRM / 不可保存受保护流；Owner 指定样例 URL，不写进用户句） | `下载这个视频` | 任务**不得**报下载成功；内部 `failure_class=drm_blocked`；侧栏人话等价于「这类受保护内容暂时保存不了」；无假文件、无 `false_complete` | **必为** `drm_blocked`（若报 success → 事故） |
| **J-DL-NONE** | 无媒体内容页（如 example.com 纯文） | `下载这个视频` | 不得报下载成功；内部宜为 `stream_not_found`（或明确「这页没有可保存的视频」之人话）；`false_complete=0` | **宜为** `stream_not_found` |

**说明：** 用户句三行下载任务**相同**（`下载这个视频`）；用前置区分 T1 happy / DRM / 无流。
评测矩阵用 `task_id` 区分，不靠改用户措辞。

---

## 最小矩阵列（跑分时）

与 013 对齐，可增 `capability_tier`：

```text
date,arm,task_id,attempt,git_sha,model,attach_mode,outcome,false_complete,wrong_tab,latency_ms,failure_class,capability_tier,notes
```

`outcome` ∈ `verified_pass` | `fail` | `invalid_run`

`capability_tier` ∈ `T0` | `T1` | `T2` | `T3` | `T4`（本表：CLOSE/PLAY/PAUSE/CONT=T0；EXTRACT=T4；DL-01=T1；DL-DRM=T3；DL-NONE=T0/T1 负例）

---

## 闸门（贾维斯可宣称「能用」的最低线）

在 `attach_mode=user_chrome` 下：

1. **J-CLOSE-01、J-CLOSE-02、J-PLAY-01、J-PAUSE-01、J-CONT-01** 各自 TSR ≥ 0.70，且 `false_complete=0`、`wrong_tab=0`。
2. **J-EXTRACT-01** TSR ≥ 0.60（可与 T0 并行演进）。
3. **J-DL-01** 在 T1 fixture 上 TSR ≥ 0.60 才可谈「能下」；**J-DL-DRM** 必须 100% 诚实拒（`drm_blocked`，0 假完成）。
4. 未过 T0 闸门 → **禁止**用下载平台叙事替代（product/011、013）。

正式 bake-off 扩表见 plan TODO 12；本文不发明 TSR 数字。

---

## 与其它文档

| 文档 | 关系 |
|------|------|
| `.omo/plans/jarvis-browser-control.md` | 本文落实 plan TODO 1；F1–F7 终验引用本表 ID |
| `product/013` | 通用 18 条；J 组后续可并入 Media-Control / Download 行 |
| `product/014` | 任务句与侧栏展示零泄漏；本表工程列仅评测用 |
| `decisions/003` | 双声口：工程码对内，人话对外 |
| `product/005` | B 站黄金旅程细则可复用前置；**用户句以本文为准** |

## 非目标

- 不在本表承诺 T2 HLS 合流已交付（另开任务 ID 时再冻句）。
- 不把 CDM 破解写成 verified_pass。
- 不把英文内部枚举写进用户任务句。
