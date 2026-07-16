# LESSONS — 可复用策略（同错≥2 才升格）

- 2026-07-16: **sticky completed UI ≠ 新任务完成** → 验收必须 `sawActiveRun` 后的新 receipt；单测：YouTube 回执不得进入 Feishu follow-up round。
- 2026-07-16: **cmux 多行 paste 常卡 Enter** → 派令后必二次 `\n` + read-screen 确认 Running。
- 2026-07-16: **无 HANDOFF 文件不算听从/完成** → 只认 `.ship/g-team/handoffs/*` + 命令 exit。
- 2026-07-16: **票 06 未绿前禁止宣称可托付** → G4 FAIL 诚实优先于假绿。
- 2026-07-16: **原样重试禁止** → 每次 FAIL 必须改指令/URL/代码/eval 之一再跑。
- 2026-07-16: **waiting_user 无 criterion-confirm 时禁止空等** → 超时写 blocked；G3 补可点确认/重试；心跳对无按钮 wait 立即改策略。
- 2026-07-16: **页上 marker 可由 CDP 注入但不算 agent 真写** → verified_pass 须 agent 路径写入或双证据链写清。
- 2026-07-16: **B站复杂 DOM 易 selector_miss** → 过夜复杂任务拆成 CDP 采集证据 + 飞书写入；agent 全链路失败不抹掉页上已有清单。
- 2026-07-16: **页上已有清单后仍派 agent 重跑易 动作调度失败** → 内容已证则封 PRODUCT_PASS，agent 路径另开票，不原样重试。
- 2026-07-16: **dispatch_failed 多来自 act throw + waiting_* 竞态** → control-llm 与 ActionDispatcher 禁止 rethrow，改 return `{error}`/uncertain；loop throw 才记 dispatch_failed。
- 2026-07-16: **uncertain 批准写后 resume 挡了但 follow_up 未挡** → 两处都 reject invalid_transition；测与 soft-return 对齐用 resolve 非 reject。
- 2026-07-16: **仅 optional 准则通过不能 verified complete** → candidate_complete 路径必须 allowsVerifiedComplete(hasRequiredCriteria)。
- 2026-07-16: **单元 residual 穷尽 + 正式 blocker 已写后禁止同目标 gnhf 空转重启** → 3m HB 只监 CDP/页证/G 台；真 e2e 等早。
