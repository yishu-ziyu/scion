# ERRORS — 失败账本（追加 only）

| 时间 | 类 | 证据 | 假设 | 下一试 |
|------|-----|------|------|--------|
| 01:36 | false_complete / sticky_receipt | golden slice-b FAIL incomplete; youtube completed UI | 旧 YouTube 回执冒充新任务完成 | 脚本要求 sawActiveRun；gnhf 加 manager 回归测 |
| 01:36–01:43 | waiting_user 无 criterion-confirm | slice-b-run waiting_user 长空转 | 提交结果不确定，UI 无 data-testid 按钮可点 | G3 查 engine/uncertain 路径；脚本扩点选文案 |
| 01:36+ | engine_start_fail | 侧栏「任务引擎启动失败」 | 扩展 dist 与运行时不一致 / SW 挂 | 文档化；早报 reload；G3 engine-fail 任务 |
| 01:44 | marker_false 批后仍无字 | approve 1 次后 waiting_user；docx 无 Scion 标记 | 批准后未真写飞书 或 写了别的 tab | 冻 URL contract-013；指令带绝对 docx URL 重跑 |
| 2026-07-16 01:52:26 CST | waiting_user_no_confirm_x3 | slice-b-run waiting_user; panel dump no criterion-confirm | waitReason≠proof_required → 无按钮 | G3 加 inputs/continue 或自动 re-observe；改 harness 检测无按钮超时 |
| 2026-07-16 01:52:26 CST | agent_write_vs_cdp_type | marker true only after G1 CDP type | 代理未完成真写 | 下一试：批准后强制 input_text 路径 + 页证再 complete |
| 2026-07-16 01:55:33 CST | waiting_user_no_confirm | attempt3 blocked | wait-afford shipped+built | attempt4 e2e with wait-continue click |
| 2026-07-16 02:02:13 CST | complex_selector_miss | complex-bili-feishu-run FAIL 找不到目标元素 | 端到端 agent 在 B 站复杂 DOM 迷路 | CDP 采集标题 + 写飞书；agent 仅跟写失败可接受 partial |
| 2026-07-16 02:09:16 CST | complex_agent_still_running_v3 | panel running no approve; page already full | agent may thrash after content done | if FAIL again: stop agent retries; content sealed |
| 2026-07-16 02:10:17 CST | complex_agent_v3_dispatch_fail | panel 动作调度失败; report FAIL | agent path unstable after content already on page | stop bare agent retry; keep PRODUCT_PASS |
| 2026-07-16 02:13:20 CST | gnhf_scion_dead_after_stop | prior gnhf stopped stop-condition; only W* alive | residual eng needs new loop | restarted gnhf residual feishu agent-write |
| 2026-07-16 02:13:35 CST | gnhf_restart_fixed | first restart skipped false positive self-match | shell if matched wrong | forced start residual |
| 2026-07-16 02:16:57 CST | dispatch_failed_mitigated_unit | G3 analysis + fix control-llm/action-dispatcher; 61/61 | throw after waiting_* | no bare e2e; gnhf residual continues |
| 2026-07-16 02:18:53 CST | gnhf_residual_notes_empty_mid_iter | notes.md empty; iteration-1.jsonl growing; pid 36983 | codex still working | wait next HB; restart only if dead |
| 2026-07-16 02:22:58 CST | gnhf_promote_reconcile_soft | manager tests 2 red after promote vs soft-return | soft-return changes throw→resolve | tests updated; 32/32 |
| 2026-07-16 02:26:18 CST | ticket_06_agent_e2e_blocked | slice-b FAIL; no overnight e2e re-run after soft-return | unit hardened only | morning controlled e2e |
| 2026-07-16 02:28:37 CST | gnhf_unit_residual_stop | soft-retu notes Owner blocker; no new code | residual exhausted | no thrash restart same objective |
