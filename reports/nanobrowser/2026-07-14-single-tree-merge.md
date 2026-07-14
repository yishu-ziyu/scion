# 2026-07-14: merge dual tree → single tree

## Decision

Stop maintaining two full copies of the nanobrowser graft.
Canonical path: `scion/projects/nanobrowser/`.
`~/projects/nanobrowser` is a **symlink** to that folder (Chrome Load unpacked path unchanged).

## Why

Dual tree caused "design fixed in workshop, not in vault" confusion.
Merge was optional; owner asked to merge.

## What was done

1. Rsynced latest runtime copy into `scion/projects/nanobrowser` (excluded nested `.git`).
2. Moved old independent tree to `~/projects/nanobrowser.bak-20260714-210044` (keeps upstream `.git` for archaeology).
3. Symlinked `~/projects/nanobrowser` → `scion/projects/nanobrowser`.
4. Updated `AGENTS.md`, `HANDOVER.md`, `README.md`, `projects/nanobrowser/AGENTS.md`.

## Verify

- `readlink ~/projects/nanobrowser` points at scion graft.
- `pnpm build` works from either path.
- Chrome still loads `~/projects/nanobrowser/dist`.

## Cleanup later (optional)

Delete `~/projects/nanobrowser.bak-*` when sure nothing is needed from old upstream git history.
