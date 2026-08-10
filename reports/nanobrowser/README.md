# 持节 / Chijie — 运行报告索引

> Folder slug `nanobrowser` is historical; product name is **持节**.

Upstream: https://github.com/nanobrowser/nanobrowser
Local path (dev): `projects/chijie-browser`
Extension id (current unpacked on this machine): `pdabbpgmfbchdfkjfgpppeakalckihjh`
Previous id (still accepted by log capture): `nnldlldkcjcooleefoflkgcjobimnaol`

## Start here for agents

Lab-level handoff (Codex): [../../HANDOVER.md](../../HANDOVER.md)

## Reports

| Date | Doc | Summary |
|------|-----|---------|
| 2026-07-15 | [Ticket 02 Slice A regression acceptance](./2026-07-15-ticket-02-slice-a-regression.md) | YouTube `/watch` verified completion, clean side panel, and one-approval form submit |
| 2026-08-06 | [outer-rl/](./outer-rl/) | 外环已跑；Skill candidates 落盘；规格 `docs/product/006-outer-loop-rl-min-plan.md` |
| 2026-08-06 | [agent-book-iteration/](./agent-book-iteration/) | 长程上下文 / Mission-Plan / LH eval 迭代报告 |
| 2026-07-13 | [2026-07-13-minimax-e2e-cdp.md](./2026-07-13-minimax-e2e-cdp.md) | MiniMax-M3 接入、401/`<think>` 修复、主 Chrome 9222 CDP、人机 E2E、多步 Navigator |
| 2026-07-14 | [2026-07-14-single-tree-merge.md](./2026-07-14-single-tree-merge.md) | Dual tree → single tree + symlink |
| 2026-07-14 | [logs/](./logs/) | CDP console drops (`LATEST.md` for agents) |

## Local ops (this machine)

- CDP tool: `~/bin/chrome-cdp ensure|status|repair`
- Main Chrome port: `9222`
- **Failure logs → disk:** `~/bin/nanobrowser-logs` (or `python3 reports/nanobrowser/scripts/capture_logs.py`)
  - Writes `reports/nanobrowser/logs/LATEST.md` + `.jsonl` (gitignored)
  - Agent reads LATEST after you say 「日志好了」
- Build: `pnpm build` → load unpacked `dist/` via `~/projects/chijie-browser` symlink
- Secrets: `chrome-extension/src/personal/secrets.local.ts` (gitignored)
- Extension id: prefer current `pdabbpgm…`; capture script also tries previous `nnldlldk…`

## Product intent (short)

持节 / Chijie: Chrome 扩展内 **长程任务 Agent** - Mission/Plan、任务级自主、页真动、人话步骤、证据完成；默认执行核 `control`（observe-act），`nano` 可拔。
Personal fork priorities: Chinese UI, MiniMax Token Plan code-level config, robust mid-model JSON parsing, long-horizon harness.
Claw 30 reports under `claw-30/` are historical eval assets, not the product north star (`docs/product/021`).
