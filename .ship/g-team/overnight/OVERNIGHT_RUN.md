# Overnight long-horizon run — Tabbit-class plugin capability

**Started:** 2026-07-16 (local)  
**Owner sleep:** until morning  
**Human-in-loop:** only morning review (section 末「需 Owner 确认」)  
**Chrome:** existing instance CDP `127.0.0.1:9222` · profile `ChromeMain` · **do not launch new Chrome**  
**W\***: do not touch  

## Goal

持节（Chrome 插件）能力向 Tabbit 对齐：**真实复杂任务可托付**；不做自研浏览器。  
P0 证据：飞书真站批准旅程（票 06）+ 能推的 L1/L2 缩差。

## StopWhen (agent)

- 飞书旅程有正式证据文件（pass/fail/blocked 分类诚实），或  
- 累计工作约 3–4h 且进度板写满下一刀，或  
- 硬阻塞仅剩 Owner 真机一点（记入「需确认」不空等）

## Phase board

| # | Phase | Status | Evidence |
|---|--------|--------|----------|
| 0 | Work mgmt + CDP attach | done | HEARTBEAT + OPS |
| 1 | Feishu login + writable target | done | doc S0Vgd writable; CDP |
| 2 | Ticket 06 journey (approve once) | FAIL_honest | golden slice-b FAIL; wait-afford shipped; agent write not green |
| 3 | Golden matrix row | partial | complex PRODUCT_PASS golden; slice-b FAIL_honest |
| 4 | 011 side-panel stop visible (if time) | deferred | not overnight P0 |
| 5 | Multi-source result path design/min slice | deferred | contract-012 frozen earlier |
| 6 | Morning packet | ready | MORNING.md + ticket-06-blocker.md |

## Log

| UTC/local | Event |
|-----------|-------|
| start | Owner: sleep mode; CDP 9222 alive; side panel open; bilibili tabs present |
Thu Jul 16 01:37:35 CST 2026

| 2026-07-16 01:45:24 | slice-b attempt3 on blank doc; gnhf round2 |
| 01:46 | HB: slice-b running on blank doc; G2-013 frozen; gnhf alive; 06 no PASS yet |

## Complex task override (2026-07-16 01:57:12 CST)
Owner: B站首页第一行 + 收藏夹第一行标题 → 飞书空白文档（批准后写）。
Spec: .ship/g-team/overnight/COMPLEX_TASK_BILI_FEISHU.md
Runner: complex CDP script background


## Complex Owner task (override)
| Status | PRODUCT_PASS_content |
| Evidence | complex-bili-live-verify.json · Feishu list 5+1 · 已保存云端 |
| Agent | FAIL×2; retries stopped |

| 2026-07-16 02:16 | G1: dispatch_failed soft-return fix + 61/61 unit |

| 2026-07-16 02:18 | build+rsync soft-return+bili harden; golden complex product row |
| 2026-07-16 02:22:58 CST | promote residual uncertain-continue block + manager 32/32 |
| 2026-07-16 02:26:18 CST | promote optional-proof+approval-replay; manager 34/34; ticket-06-blocker written |


### Overnight unit stack (02:27)
| Layer | Status | Evidence |
|-------|--------|----------|
| complex Bili→Feishu content | PRODUCT_PASS | golden + live CDP |
| ticket 06 agent e2e | FAIL_honest / BLOCKED morning | ticket-06-blocker.md |
| soft-return dispatch | unit green | 61/61 |
| uncertain continue/pause | unit green | manager 34/34 |
| optional-proof / approval-replay | unit green | manager 34/34 |
| bilibili card identity | unit green | action-target 14/14 |
| 2026-07-16 02:28:37 CST | gnhf soft-retu-09f7dd STOP: ticket-06 agent e2e Owner blocker recorded; unit residual exhausted |
| 2026-07-16 06:57:31 CST | OVERNIGHT_STOP_07 pre-seal | morning band | unit residual sealed | Owner wake |

## OVERNIGHT_SEALED_07 · 2026-07-16 07:00:29 CST
| Item | Final |
|------|-------|
| complex Bili→Feishu | PRODUCT_PASS (content) |
| ticket 06 agent e2e | FAIL_honest / blocked morning |
| unit residual | sealed (soft-return, uncertain, optional-proof) |
| monitor | product stable through night |
| Owner next | MORNING_SUMMARY.md · optional controlled e2e |

## OWNER_STOP · 2026-07-16 11:36:51 CST
- 主人确认停止 3min 心跳（已过早7 + 已到 ~11:xx）
- 终态：SEALED_07 + PRODUCT_PASS_content · agent 路径仍未 verified_pass
- 下一步仅主人验收飞书；不再自动调度
