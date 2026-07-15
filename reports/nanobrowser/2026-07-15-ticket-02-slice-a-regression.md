# Ticket 02 Slice A regression acceptance — 2026-07-15

## Verdict

**PASS for the requested Slice A regression.**

Branch: `feature/ticket-02-observe-act-loop`

Reviewed runtime fixed point: `4582ed29373d0406c50fe772aee8ba72b9c7361b`

Loaded unpacked extension: `持节：可验证浏览器行动 Agent` (`ndgepamohiegdnpooefoedambmcimaii`)

The owner later authorized consolidating this runtime slice, the subsequent UI lane, and the QA artifacts into the final branch. The runtime claims in this report remain scoped to the fixed point above.

Concurrency note: after the final runtime run, a parallel Grok UI lane began changing `TaskStatusCard`, design CSS/docs, and UI acceptance tests in the same worktree. Those later files are outside this verdict and were not loaded into the extension used below.

## Runtime acceptance

| Scenario | Result | Evidence |
|---|---:|---|
| `打开YouTube，并且点击第一行的第一个视频` | PASS | `running → completed`; receipt and execution step present; no approval; final URL `https://www.youtube.com/watch?v=1czuYAQ8dHM` |
| Empty side panel promotion cleanup | PASS | No Star GitHub / Follow X / Discord / `nanobrowser_ai`; no empty `快速开始`; visible links `[]` |
| Real form Submit safety | PASS | `running → waiting_approval → running → completed`; fixture count `0` before approval and `1` after; approval clicked exactly once; receipt present |

Screenshots are under `.ship/tasks/tabbit-class-product/qa/screenshots/`:

- `youtube-final-sidepanel.png` and `youtube-watch.png`
- `sidepanel-clean.png`
- `form-waiting-approval.png`, `form-final-page.png`, and `form-final-sidepanel.png`

## Build and regression checks

- `pnpm build`: PASS; Turbo ready 8/8 and build 5/5.
- Chrome extension focused regression: 19 files, 174/174 tests PASS.
- Side panel regression for the validated Slice A snapshot: 5 files, 45/45 tests PASS. The later parallel UI lane currently owns any subsequent side-panel test state.
- Changed-file Prettier check and `git diff --check 4582ed2`: PASS.
- `@extension/storage` type-check: PASS.
- Repository type-check remains red on existing `schema-utils` missing generated modules. Targeted Chrome type-check reports six existing errors in four untouched files; side-panel type-check reports existing i18n-key typing debt in `TaskStatusCard.tsx` plus an unchanged header expression in `SidePanel.tsx`. No error points to a changed hunk from this slice.

## Diagnosed regressions

1. The old two-second `Promise.race` did not cancel a started pointer click. A YouTube link or approved Submit could time out, then mutate later while the loop continued or marked the commit uncertain. Observed unchanged anchors now activate once in-page; other started pointer clicks are awaited to a single outcome.
2. The implicit Chinese success-text parser froze `Saved successfully 后完成`. It now strips the completion clause, including curly quotes and `后，完成` variants.
3. The body-text fallback flattened line breaks, so `Bake-off form` and `Saved successfully` became one unmatched digest. It now preserves bounded line candidates (200,000 characters / 2,000 candidates).
4. Legacy favorite cleanup previously inferred provenance from broad substrings. It now removes only exact untouched upstream defaults and has a regression test preserving user-authored prompts.

## Deliberate residual risks

- An unrecognized JavaScript-only commit control (`role=button` / `type=button` without native or semantic commit signals) can still be misclassified as reversible. Tightening this globally would reintroduce the false-approval loop that this slice was asked to remove, so it needs an explicit product-policy decision.
- `/watch` proves that a YouTube video opened, but does not bind the receipt to the exact first tile. This matches the requested Slice A stop condition; stronger observe-to-act target binding belongs in a separate hardening slice.
- The production model still returns DOM indexes without carrying the full observed page revision and target digest through its action contract.

## Next order

After owner-authorized commit/push of this slice: Ticket 07 media continuous control. Ticket 06 remains blocked until a writable Feishu URL and authenticated session are available.
