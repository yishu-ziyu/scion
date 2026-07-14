# 2026-07-14: merge dual tree → single tree

## Decision

Stop maintaining two full copies of the nanobrowser graft.
Canonical path: `scion/projects/yishu-browser/`.
`~/projects/yishu-browser` is a **symlink** to that folder (Chrome Load unpacked path unchanged).

## Why

Dual tree caused "design fixed in workshop, not in vault" confusion.
Merge was optional; owner asked to merge.

## What was done

1. Rsynced latest runtime copy into `scion/projects/yishu-browser` (excluded nested `.git`).
2. Moved old independent tree to `~/projects/yishu-browser.bak-20260714-210044` (keeps upstream `.git` for archaeology).
3. Symlinked `~/projects/yishu-browser` → `scion/projects/yishu-browser`.
4. Updated `AGENTS.md`, `HANDOVER.md`, `README.md`, `projects/yishu-browser/AGENTS.md`.

## Verify

- `readlink ~/projects/yishu-browser` points at scion graft.
- `pnpm build` works from either path.
- Chrome still loads `~/projects/yishu-browser/dist`.

## Cleanup later (optional)

Delete `~/projects/yishu-browser.bak-*` when sure nothing is needed from old upstream git history.
