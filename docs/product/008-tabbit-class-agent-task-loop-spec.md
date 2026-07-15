---
title: "Tabbit 级 Agent 任务环规格（持节 MVP）"
description: "grill-with-docs 确认后的 to-spec：任务模式、扩展壳、TS 双层核、切片顺序与验收。"
category: "product"
number: "008"
status: current
services: ["projects/chijie-browser"]
related: ["product/001", "product/003", "product/005", "decisions/001", "decisions/002"]
last_modified: "2026-07-15"
---

Canonical full English spec (Matt template):

`.ship/tasks/tabbit-class-product/spec/SPEC.md`

This file is the product index entry. Edit the canonical file first when the spec changes.

## One-line

Chrome 扩展侧栏任务模式 + 页真动 + 人话步骤 + 证据完成；核为扩展内 TS（Agent 环 + 浏览器控制）；先 YouTube 最小绿，再飞书批准 / B 站暂停。

## Locked decisions

See `CONTEXT.md` (Agent task loop, Shell vs core, Approval policy, Delivery order, In/Out scope).

## Next

1. Owner confirms test seams S1–S5 in SPEC.md  
2. `/to-tickets` vertical slices  
3. `/implement` + `/tdd` per ticket · no-mistakes on ship  
