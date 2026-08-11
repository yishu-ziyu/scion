# 023 证据空间隔离 E2E

日期：2026-08-11  
模型：MiniMax-M3  
环境：ego-browser 独立任务空间 15；不操作 Owner 正在使用的浏览器窗口。

## 测试任务

在 `https://example.com/` 读取正文，以 `product:example-domain` 写入一条 product 证据记录；再次写入同一记录验证去重；检查证据空间并返回新增数、重复数与产品记录数。全程不得离开当前页面。

## 观察到的真实执行链

1. `record_evidence`：observed，新增 1 条。
2. `record_evidence`：observed，同一 `dedupe_key` 被识别为重复。
3. `inspect_evidence_space`：observed，产品记录数为 1。
4. 最终任务状态：`completed`；trace terminalStatus 为 `completed`。
5. 最终结果作为助手消息可见：新增数 1、重复数 1、产品记录数 1/30，来源保持 `https://example.com/`。

任务 ID：`63b3cbe4-adb8-448c-b3f2-a44993bc1dba`。

## E2E 暴露并修复的问题

- 首次运行：模型选择了 `record_evidence`，但动作参数格式不明确，解析前失败。修复为明确参数契约，并兼容单条记录的常见外形；来源与内容质量门未放松。
- 第二次运行：写入、去重、检查均成功，但旧规则把“页面未变化”误判为 `no_progress`。修复为识别新的本地语义结果，同时重复相同结果仍会触发停滞保护。
- 第三次运行：完整通过。

## 当前判断

证据空间最小闭环已成立：实际页面阅读后的持久写入、严格当前来源绑定、去重、独立产品计数、模型进度读取、可见最终交付均有真实运行证据。

这不等于 `023-LR-01` 已通过。80/30、GitHub 项目理解、交叉验证、恰好三个决策与飞书回读仍需完整运行验收。
