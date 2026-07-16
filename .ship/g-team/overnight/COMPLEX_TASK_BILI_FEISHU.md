# 过夜复杂任务（Owner 睡前指定）

**Status:** PRODUCT_PASS_content (agent path partial)  
**指定时间:** 2026-07-16  
**执行面:** 日常 Chrome CDP `9222` · 持节侧栏 · 不新开浏览器 · 禁 W\*

## 用户任务（冻结句）

```text
打开哔哩哔哩（B站）。
1）读取首页可见的第一行视频标题（首页推荐/热门区第一行里每个视频的名称）。
2）打开收藏夹，读取收藏夹列表中第一行视频的名称。
3）把上述名称整理成清单，写入飞书空白文档：
   https://zib9x25efxe.feishu.cn/docx/S0Vgd9zotoSwS1xx2dicC80xn1b
4）写入飞书正文前必须停下等待批准；批准后只写这一次清单，不改文档标题、不追加无关内容。
5）完成后以飞书页面可见这些标题文字且显示已保存/同步为证据结束；禁止假完成。
```

## 成功标准（Matt）

| # | 当… | 应… |
|---|-----|-----|
| 1 | 任务结束 | 侧栏非永久 running；有 completed+receipt 或诚实 failed/waiting |
| 2 | 飞书文档 | 正文可见首页标题列表 + 收藏夹第一行标题（至少各有可读条目） |
| 3 | 批准 | 写飞书前出现 approval；批前 0 次外部写；批后恰好 1 次写入意图 |
| 4 | 证据 | golden/overnight 报告 + 可选截图路径 |

## 非目标

- 不下载视频、不点赞投币、不改收藏夹
- 不打开新 Chrome profile
- 不动 W\* 协作台

## 进度

| 时间 | 事件 |
|------|------|
| start | Owner 指定；写入本文件；启动侧栏任务 |

| 01:58 | complex-bili-feishu.mjs pid running; goal sent on CDP |

| 2026-07-16 02:02:13 CST | agent FAIL selector_miss; CDP harvest+write → feishu list present PARTIAL |

| 2026-07-16 02:09 CST | live CDP re-verify: 首页5+收藏1 全在飞书且已保存云端 → PRODUCT_PASS_content |
