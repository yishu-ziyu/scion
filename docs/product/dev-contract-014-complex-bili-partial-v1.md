---
title: "dev-contract-014 complex B站→飞书 PARTIAL vs verified_pass"
status: frozen
version: v1
owner: G1
spec_author: G2
created: "2026-07-16"
source: ".ship/g-team/overnight/COMPLEX_TASK_BILI_FEISHU.md"
---

# Contract 014-v1 — 过夜复杂任务：PARTIAL_PASS_page_content vs verified_pass

**verified_pass** 只在整条冻结句由**持节 agent 全链路**完成时成立：B 站首页第一行标题与收藏夹第一行标题均由 agent 读出 → 写飞书前 `waiting_approval` 且批前 0 写入 → Owner 批准后恰 1 次写入意图 → 飞书页可见清单文字且已保存/同步 → 侧栏 `completed`+receipt，且 `false_complete=0`、`unapproved_commit=0`。  
**PARTIAL_PASS_page_content** 表示**页面内容层**已满足「飞书正文可见约定清单（如含【B站首页第一行】等标题条目）且已保存」这一观察结果，但**不**等于任务成功：agent 中途 `failed`（如 `selector_miss`）、采集/写入靠 CDP 旁路、缺批准闸门、或缺侧栏 completed+receipt 时，矩阵 outcome 必须记 `PARTIAL_PASS_page_content`（或 `failed`+失败类），**禁止**升格为 `verified_pass`，也禁止对用户宣称复杂任务可托付。  
过夜分母以 `COMPLEX_TASK_BILI_FEISHU.md` 为准；本定义仅冻结这两种 outcome 的边界，不触 W*。
