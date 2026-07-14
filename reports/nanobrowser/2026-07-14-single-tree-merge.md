# 2026-07-14: merge dual tree → single tree

## Decision

Stop maintaining two full copies of the nanobrowser graft.
Canonical path: `scion/projects/chijie-browser/`.
`~/projects/chijie-browser` is a **symlink** to that folder (Chrome Load unpacked path unchanged).

## Why

Dual tree caused "design fixed in workshop, not in vault" confusion.
Merge was optional; owner asked to merge.

## What was done

1. Rsynced latest runtime copy into `scion/projects/chijie-browser` (excluded nested `.git`).
2. Moved old independent tree to `~/projects/chijie-browser.bak-20260714-210044` (keeps upstream `.git` for archaeology).
3. Symlinked `~/projects/chijie-browser` → `scion/projects/chijie-browser`.
4. Updated `AGENTS.md`, `HANDOVER.md`, `README.md`, `projects/chijie-browser/AGENTS.md`.

## Verify

- `readlink ~/projects/chijie-browser` points at scion graft.
- `pnpm build` works from either path.
- Chrome still loads `~/projects/chijie-browser/dist`.

## Cleanup later (optional)

Delete `~/projects/chijie-browser.bak-*` when sure nothing is needed from old upstream git history.
