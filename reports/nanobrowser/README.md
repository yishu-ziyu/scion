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

## Local ops (this machine)

- CDP tool: `~/bin/chrome-cdp ensure|status|repair`
- Main Chrome port: `9222`
- Build: `pnpm build` → load unpacked `dist/`
- Secrets: `chrome-extension/src/personal/secrets.local.ts` (gitignored)

## Product intent (short)

BYOK AI browser agent (Planner / Navigator), Chrome first, personal multi-model package later.
Personal fork priorities: Chinese UI, MiniMax Token Plan code-level config, robust mid-model JSON parsing.
