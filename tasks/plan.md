# Implementation Plan: Agent execute loop（SPEC.md）

## Overview

落实根目录 `SPEC.md`：`execute` 之后 Agent 开页、看页、决定、动手。
生产路径保持 `createLlmControlDriver` + `runObserveActLoop`。
本计划不写 `completed` / `persistVerifiedReceipt`，不改侧栏审美。

## Architecture Decisions

- iframe `attach` 失败必须出现在 `ObservationFrame.inaccessibleIframes`。不得只 `skip` 后当完整页。
- 邮箱开哪家是 `decide` 的纯函数（`mailbox-open.ts`），不写死 `mail.google.com` 为默认。常用主机来自 `user-memory-v1` 条目「常用邮箱」（旧键 `usual-mailbox-v1` 迁入）。
- 登录墙：页上已是登录墙时，强制 `waiting_user` + `login_required`，即使用户模型想 `input_text` 密码框。
- iframe e2e 并入 `pnpm e2e:action-agent`（同一脚本加场景），父页与 pay 框用两个端口做成跨源。

## Task List

见 `tasks/todo.md`。顺序：采集报告 → 观察/策略门闩 → 邮箱策略 → 登录墙门闩 → 真 Chrome iframe e2e。

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| 同页 iframe 在 Chrome 里不是独立 target | e2e 假绿 | 两端口跨源，断言子框 input 值 |
| 工作区已有大量无关 diff | 提交会混进 | 本轮只改 spec 相关文件，不 `git add -A` |
| 常用邮箱存储被当成通用记忆 | 产品越界 | 只存 `{ host }` 一条 |

## Open Questions

无（SPEC Open Questions 已清空并批准）。
