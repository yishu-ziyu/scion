# Media 播放验收（e2e 共用路径，非 Claw 30 目录条目）

- **问题：** 任务回执说「正在播放」，页面 `#fixture-audio.paused === true`
- **原因：** 测试用静音 wav 原先约 1 秒且不循环；播放完成瞬间记了 playing 回执，e2e 再读 DOM 时已经结束
- **修复：** wav 拉长到约 30 秒；`<audio loop>`
- **证据（2026-07-24）：** `e2e:action-agent` 全绿  
  `media play PASS` → `media PASS`（含 pause）→ `privacy PASS`  
  日志：`reports/nanobrowser/claw-30/O1/e2e-action-agent.log`
