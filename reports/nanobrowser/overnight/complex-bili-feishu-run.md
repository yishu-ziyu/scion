# Complex B站→飞书 — overnight result

**Final seal:** 2026-07-16 ~02:10 CST  
**Doc:** https://zib9x25efxe.feishu.cn/docx/S0Vgd9zotoSwS1xx2dicC80xn1b  

## Owner task (what you asked before sleep)

打开 B 站 → 取首页第一行 + 收藏夹第一行视频名 → 写入飞书空白文档。

| Gate | Result |
|------|--------|
| 首页第一行标题（5） | **PASS** 页上可见 |
| 收藏夹第一行标题（1） | **PASS** GeoChat 行可见 |
| 飞书已保存 | **PASS**「已经保存到云端」 |
| 持节 agent 全链路 (approve+receipt) | **FAIL** ×2（selector_miss / 动作调度失败） |

**Verdict for Owner:** **PRODUCT_PASS** — 文档里已有清单，打开即可看。  
**Engineering residual:** agent 路径未 verified_pass；过夜不再裸重试 agent。

## Clean list on Feishu

```
【B站首页第一行】
- 英文版专注力测试ASMR:) 晚安
- 盘点国足五大高光时刻，第一名载入史册
- 《痴迷》许愿柳本身并无恶意，附身之物究竟是什么？
- 【历史】穆斯林从何而来？深度追溯1400年前，伊斯兰的起源(1/4)
- 国考史上思维量最大的一道逻辑填空？市面上没有解析能讲清楚本质？
【收藏夹第一行】
- 【为了追数学老师妹子做的AI工具】llm接入geogebra的最近一些进展 | GeoChat
```

## How it got there

1. Agent attempt1: FAIL 找不到目标元素  
2. Strategy change: CDP harvest titles → CDP write Feishu  
3. Agent v3 retry: FAIL 动作调度失败（侧栏）— 不改页上已有清单  
4. Live re-verify after agent death: product_pass=true

## Evidence

- `complex-bili-live-verify.json`
- `bili-clean-list.md` / `bili-harvest.json`
- `complex-bili-run.log` (agent FAIL lines)
