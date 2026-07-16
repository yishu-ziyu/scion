# 06 — Slice B: Feishu form + approval (simplified G3)

**What to build:** On Owner daily Chrome login, agent fills a designated Feishu form/doc field, **stops before submit**, Owner approves, single submit, page success evidence, completion receipt. Same core as Slice A—not a second product.

**Blocked by:** 03 — Slice A YouTube E2E; 05 — External-commit approval gate

**Status:** in-progress · Feishu target ready · live approval journey running

**Seams:** S5, S2

- [x] Agent proactively verifies Feishu login and creates a writable test target
- [ ] MiniMax-M3 formal run
- [ ] Zero submit before approval; one submit after
- [ ] Verified completion from page evidence only
- [ ] Matrix row + notes under `reports/nanobrowser/golden/` (or agreed path)
- [ ] Failure classified if blocked (login_wall etc.)

### 2026-07-15 环境阻塞

- P0 已主动打开日常 Chrome，并打开 `chrome://inspect/#remote-debugging`。
- Chrome 当前未允许远程调试，Agent 尚不能读取或操作日常浏览器；未到飞书登录态检查阶段。
- Owner 只需勾选 **Allow remote debugging for this browser instance**；随后由 P3 自行打开飞书、寻找或创建可写目标并推进旅程。

### 2026-07-15 恢复

- Owner 已开启 Chrome 远程调试；P0 已连接日常 Chrome。
- P0 主动打开飞书与云文档首页，页面显示“奕枢，欢迎回到飞书”，登录态已确认。
- P0 已通过当前用户身份创建空白测试文档 `Scion G3 真站验收（空白）`；P3 已确认正文可编辑且未写入内容。
- P3 已确认持节侧栏真实打开；无需 Owner 提供链接。

### 本轮真站脚本

- 目标：新建空白测试文档，仅写入一行 `Scion G3 验收测试：无业务内容。`
- 持节必须在首次写入前暂停；Owner 的一次批准只授权这一行写入，不改标题、不追加其他内容。
- 成功只认飞书页面可见完整文字，并显示已保存或同步完成；否则不得生成完成回执。

### P4 现场闸门

- 同一轮记录：脱敏目标、时间、模型、roundId 与 external commit 边界。
- 批准前：页面未写入，侧栏 waiting approval，external commit=0。
- 批准：唯一 approvalId 与一次 Owner 操作。
- 批准后：同一 approvalId 对应 external commit=1，并保留执行状态链。
- 完成：飞书页面成功态出现后才生成 receipt；无成功态只能 failed 或 waiting user。
