# Nanobrowser 二开报告索引

Upstream: https://github.com/nanobrowser/nanobrowser  
Local path (dev): `projects/nanobrowser`  
Extension id (unpacked on this machine): `nnldlldkcjcooleefoflkgcjobimnaol`

## Start here for agents

Lab-level handoff (Codex): [../../HANDOVER.md](../../HANDOVER.md)

## Reports

| Date | Doc | Summary |
|------|-----|---------|
| 2026-07-13 | [2026-07-13-minimax-e2e-cdp.md](./2026-07-13-minimax-e2e-cdp.md) | MiniMax-M3 接入、401/`<think>` 修复、主 Chrome 9222 CDP、人机 E2E、多步 Navigator |
| 2026-07-14 | [2026-07-14-single-tree-merge.md](./2026-07-14-single-tree-merge.md) | Dual tree → single tree + symlink |
| 2026-07-14 | [logs/](./logs/) | CDP console drops (`LATEST.md` for agents) |

## Local ops (this machine)

- CDP tool: `~/bin/chrome-cdp ensure|status|repair`
- Main Chrome port: `9222`
- **Failure logs → disk:** `~/bin/nanobrowser-logs` (or `python3 reports/nanobrowser/scripts/capture_logs.py`)
  - Writes `reports/nanobrowser/logs/LATEST.md` + `.jsonl` (gitignored)
  - Agent reads LATEST after you say 「日志好了」
- Build: `pnpm build` → load unpacked `dist/` via `~/projects/nanobrowser` symlink
- Secrets: `chrome-extension/src/personal/secrets.local.ts` (gitignored)
- Extension id (current): `pdabbpgmfbchdfkjfgpppeakalckihjh`

## Product intent (short)

BYOK AI browser agent (Planner / Navigator), Chrome first, personal multi-model package later.
Personal fork priorities: Chinese UI, MiniMax Token Plan code-level config, robust mid-model JSON parsing.
