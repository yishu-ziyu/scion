→ 先读 `MORNING_SUMMARY.md`（同目录）

# 明早 Owner 确认包（中途不打断）

## 需你确认 / 动手（人）

1. **扩展是否要重载**：过夜改了代码但可能未 `pnpm build` + reload；若侧栏仍「任务引擎启动失败」，请：build → 扩展页 reload → 再开侧栏。
2. **飞书文档**目标：见 `feishu_target_url.txt`（若有）。确认正文是否出现 `ScionG3-TEST-*` 标记。
3. **是否采纳 gnhf worktree 提交**：`scion-gnhf-worktrees/overnight-scion-chij-de2a2c`（假完成回归测）合并进主树。
4. **产品方向**：012 合同已冻「多源→结构化结果」——是否按此为 06 后下一刀（可改）。

## 不需要你确认（盘上已有证据）

- G 台闭环：010/011 自动化 PASS 证据
- G4 对 06 的独立 **FAIL** 判定（未假绿）
- 10 分钟心跳 scheduler 已挂
- CDP 9222 日常 Chrome、飞书登录态曾确认

## 打开顺序

1. `docs/product/G-TEAM-LIVE.md`
2. `.ship/g-team/overnight/OVERNIGHT_RUN.md` + `HEARTBEAT.md`
3. `reports/nanobrowser/golden/slice-b-*` 与 `G4-overnight-06.md`

## 追加（心跳）
5. 是否采用 `dev-contract-013-feishu-06-rerun-v1.md` 作为 06 正式复跑分母（URL 已冻）。
6. 侧栏若仍「任务引擎启动失败」：按 G3 明早报告处理（可能需 reload 扩展）。

7. **waiting_user 无按钮**：是否接受 G3 增加 wait-continue/retry 产品控件（过夜已派）。
8. attempt3 文档是否保留 CDP 注入的 ScionG3-TEST 行（非 agent 纯写）。

## 复杂任务验收（睡前指定）
9. 打开飞书文档，是否有「B站首页第一行 / 收藏夹第一行」标题清单。
10. 侧栏是否 completed+receipt；批前是否未偷写。
11. 报告：`reports/nanobrowser/overnight/complex-bili-feishu-run.md`

12. **复杂任务结果：** 飞书是否已有「【B站首页第一行】」清单（CDP 写入）；agent 全链路仍 FAIL。
13. 是否接受「采集用 CDP / 写入走 agent」分层作为复杂任务过渡方案。

14. **复杂任务盘上结论（02:09）：** 飞书空白文档已含首页第一行 5 条 + 收藏夹第一行 1 条，页面显示「已经保存到云端」。打开即可验收。
15. Agent 全链路（批准回执）仍未 verified_pass；是否接受 CDP 采集/写入作为今晚完成定义。

16. **gnhf worktree bilibili harden** 已拷入主树并 14/14：是否合入/commit `page.ts` + `action-target.test.ts`（worktree: scion-only-harden-se-8251f2）。
17. complex 任务按 **PRODUCT_PASS_content** 验收即可；agent 金路径仍红，勿当 verified_pass。

18. 过夜已 `pnpm -F chrome-extension build`（soft-return + bili harden）；若侧栏仍旧行为，扩展页手动 reload 一次。
19. Golden：`reports/nanobrowser/golden/complex-bili-feishu-product-2026-07-16.md`（内容 PASS / agent NO）。

20. gnhf residual：uncertain 批准写后 **禁止 continue/follow_up** 已进主树（manager 32/32）。是否 commit。
21. 扩展 runtime.reload 后侧栏可能关；过夜已 CDP 重开。

22. 读 `reports/nanobrowser/overnight/ticket-06-blocker.md`：agent 金路径仍红；单元硬化已齐。
23. manager 现 34/34（含 optional-proof、approval-replay、uncertain-continue soft-return 对齐）。

## OWNER_STOP · 2026-07-16 11:36:51 CST
- 心跳已按主人指示停止
- 验收：飞书文档清单仍在即可
