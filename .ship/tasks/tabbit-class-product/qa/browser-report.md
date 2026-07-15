# Browser QA Report — Slice A YouTube + approval regression

Date: 2026-07-15 (Asia/Shanghai)

Branch: `feature/ticket-02-observe-act-loop`

Runtime fixed point: `4582ed29373d0406c50fe772aee8ba72b9c7361b`

Loaded extension: `持节：可验证浏览器行动 Agent` (`ndgepamohiegdnpooefoedambmcimaii`)

> Concurrency boundary: a parallel Grok UI lane started changing `TaskStatusCard`, design CSS/docs, and UI acceptance tests after the final runtime run. Those later changes were not loaded into this tested extension snapshot.

## Result

| Criterion | Result | Runtime evidence |
|---|---|---|
| Exact task `打开YouTube，并且点击第一行的第一个视频` reaches `/watch`, completes, and does not request approval | PASS | `running → completed`; completion receipt present; one observed step; `approvalSeen=false`; final URL `https://www.youtube.com/watch?v=1czuYAQ8dHM` |
| Side panel removes Star GitHub / Follow X / Discord / Nanobrowser promotion and hides empty 快速开始 | PASS | No matching text or links; visible links `[]`; 快速开始 absent |
| A genuine form submit waits for one approval and commits only after that approval | PASS | `running → waiting_approval → completed`; fixture submit count `0` before approval; approval clicked once; final count `1`; page shows `Saved successfully`; completion receipt present |

## Evidence

- `screenshots/youtube-final-sidepanel.png` — completed status and receipt.
- `screenshots/youtube-watch.png` — real YouTube watch page.
- `screenshots/sidepanel-clean.png` — clean side panel with no upstream promotion.
- `screenshots/form-waiting-approval.png` — approval card before the submit.
- `screenshots/form-final-page.png` — `Saved successfully` after one submit.
- `screenshots/form-final-sidepanel.png` — completed status and verified receipt after one approved submit.

## Build and automated checks

- `pnpm build`: PASS; Turbo ready 8/8 and build 5/5.
- Extension reloaded from `projects/chijie-browser/dist/` through `chrome://extensions`.
- Chrome extension focused regression: 19 files, 174 tests PASS.
- Side panel regression: 5 files, 45 tests PASS.
- Chrome extension type-check still reports six pre-existing errors in four untouched files (`control-loop.test.ts`, `factory-backend.test.ts`, `helper.ts`, `oss-ideas.experiments.test.ts`); the production build and changed-file tests pass.

## Diagnosis and excluded runs

The initial clean YouTube failure was three `Click timeout` errors. `Page.clickElementNode` raced an already-started Puppeteer pointer click against a two-second timer; losing the race did not cancel the click, so the outer control loop could start another click. A direct same-browser click proved the YouTube link itself was valid. The fix activates an observed, unchanged `<a href>` once in one page evaluation and leaves buttons/forms on the existing guarded path.

The first successful form submit still paused for proof. Diagnosis found two independent completion-text defects: the Chinese goal parser included the trailing `后完成` in the expected text, and the plain-body fallback flattened line breaks before matching. Regression tests now freeze only `Saved successfully` and preserve body line boundaries. The final same-window run completed with a receipt after exactly one approved submit.

A later final rerun exposed the same non-cancellable timeout defect on the approved Submit button: the two-second race marked the attempt uncertain with count `0`, then the original pointer click committed at the third second and count became `1`. The click path now awaits the single started pointer action instead of abandoning it; the final rerun again reached `completed` with count `0 → 1` and one approval.

One early form run opened the fixture in another Chrome window, so the side panel operated on `w3schools.com`; it was discarded. Two fill-and-submit prompts were also discarded because the model repeatedly targeted the input and never proposed Submit. The final submit-only run isolates the required approval behavior on the real fixture.

## Remaining risk

The production model currently receives DOM indexes without carrying the observed page revision/target digest back in its action. Dispatcher audit data therefore cannot fully reject every observe-to-act index drift. This was not needed to close the current Slice A regression, but should be planned as a separate binding-hardening slice instead of folded into the YouTube patch.

The current accepted Slice A rule treats ordinary links/buttons as reversible unless native form or semantic commit signals identify a submit. A JavaScript-only commit control with no recognizable commit semantics remains a policy edge case. Also, `/watch` proves that a YouTube video opened, not that it was cryptographically bound to the exact first tile. Both require separate product-policy decisions; neither was broadened inside this regression slice.
