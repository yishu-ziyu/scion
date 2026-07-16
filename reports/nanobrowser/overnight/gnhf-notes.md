# Overnight GNHF notes

## Iteration 1 — stale receipt regression guard

- Added a TaskManager regression covering a verified YouTube round followed by a new Feishu goal.
- The new round must remain `running`, have no receipt/evidence inherited from YouTube, and run the executor with the new round ID; the old receipt remains historical only.
- Verification: observe-act loop 6/6, TaskManager 33/33, side-panel failure taxonomy 4/4; touched-file ESLint, Prettier, and `git diff --check` pass.
- Full Chrome-extension type-check remains red on pre-existing unrelated errors in control/factory/OSS experiment tests, `agent/helper.ts`, and the absent gitignored `secrets.local.ts`.
- Remaining ticket 06 risk: prove external-commit approval ordering and single-submit behavior for the Feishu-shaped journey; real Feishu acceptance still requires the Owner login/URL.
# GNHF overnight notes

## 2026-07-16 — Bilibili card selector hardening (G4)

### Increment

Hardened the existing DOM locator for Bilibili video cards without weakening click safety. When the observed absolute CSS selector and XPath both miss after a card moves, the locator now makes one Bilibili-only fallback using the stable `BV...` or `av...` video identity from the observed link.

The fallback:

- only activates for anchors whose parsed host is `bilibili.com` or a subdomain and whose path is `/video/<id>`;
- narrows candidates with `a[href*="/video/<id>"]`;
- re-parses each live candidate and accepts only the same video ID;
- disposes rejected or duplicate candidates;
- leaves the existing final full-href check in `clickElementNode` unchanged, so changed destinations still fail closed.

### Tests

Added Matt-style behavior tests in `chrome-extension/src/background/browser/__tests__/action-target.test.ts`:

1. stale DOM position recovers the same Bilibili video card;
2. a different video ID is rejected and its handle is disposed.

TDD evidence: the recovery test first failed with `expected null` because the fallback did not exist; the wrong-video test first failed because the candidate was returned instead of rejected.

### Verification

- `pnpm -F chrome-extension test`: PASS, 26 files / 233 tests.
- `pnpm exec eslint chrome-extension/src/background/browser/page.ts chrome-extension/src/background/browser/__tests__/action-target.test.ts`: PASS.
- `pnpm exec prettier --write ...`: PASS; production file unchanged, test formatted.
- `pnpm inject:personal && pnpm -F chrome-extension build`: PASS (Vite emitted the existing browser-compatibility warning for `crypto`).
- Full workspace `pnpm -F chrome-extension type-check`: baseline FAIL with six diagnostics in untouched control-loop/factory/OSS experiment tests and `agent/helper.ts`; no error referenced either touched file. Personal injection removed the initial missing-secret diagnostic, and the later build passed.
- Full workspace `pnpm -F chrome-extension lint`: baseline FAIL with 12 errors in untouched `agent/helper.ts`, `agent/messages/utils.ts`, and `browser/dom/history/view.ts`; targeted lint for both touched files passed.

### Boundary

This is a deterministic G4 selector increment only. It does not claim a real Bilibili golden-journey attempt or change the M3 score; owner-Chrome evidence remains required for G4 completion.

# Scion-only GNHF notes

## 2026-07-16 — reject continue after an uncertain approved write

- Surface: scion-only `projects/chijie-browser`; no W workspace or bare complex Bilibili agent run.
- Gate mapping: M3 / G3 Feishu external-commit safety — approval may authorize one write, never a retry whose first outcome is unknown.
- Outcome: `TaskManager` now rejects both `resume` and natural-language `follow_up` while the current round is `waiting_user / commit_outcome_uncertain`. The original round remains current, no replacement round or receipt appears, and the approved external commit is invoked once.
- Regression: the disconnect-time commit test now covers the wait→continue path, asserts `invalid_transition`, one round, no receipt, no driver follow-up, and one write attempt.

### Matt-style tests and exits

| Command / check | Exit | Result |
|---|---:|---|
| Focused regression before production guard | 1 | Expected red: `follow_up` was accepted after an approved commit became uncertain. |
| `pnpm -F chrome-extension test -- src/background/task/__tests__/manager.test.ts -t "keeps a disconnect-time commit uncertainty non-resumable and non-continuable"` | 0 | Green after the guard; 1/1 passed. |
| `pnpm -F chrome-extension test -- src/background/task/__tests__/manager.test.ts` | 0 | Manager suite: 32/32 passed. |
| `pnpm -F chrome-extension test` | 0 | Chrome-extension suite: 26 files / 231 tests passed. |
| `pnpm exec eslint chrome-extension/src/background/task/manager.ts chrome-extension/src/background/task/__tests__/manager.test.ts --ext .ts` | 0 | Touched-file lint passed. |
| `pnpm exec prettier --check chrome-extension/src/background/task/manager.ts chrome-extension/src/background/task/__tests__/manager.test.ts` | 0 | Touched-file formatting passed. |
| `pnpm inject:personal && pnpm -F chrome-extension build` | 0 | Production extension bundle built; only the existing Vite `crypto` compatibility warning appeared. |
| `pnpm -F chrome-extension type-check` | 2 | Existing unrelated diagnostics in control-loop/factory/OSS experiment tests and `agent/helper.ts`; neither touched file was reported. |

### Boundary

This increment closes the unsafe uncertain-write continuation seam only. It does not claim a real Feishu golden-journey attempt or change the M3 score; Owner Chrome login and a writable Feishu target remain required for G3 evidence.

# GNHF overnight notes — SCION-only next residual

Date: 2026-07-16

## Residual found: uncertain-commit pause edge lacks focused evidence

Scope inspected: `TaskManager` command transitions for a task persisted as
`waiting_user` with `waitReason: commit_outcome_uncertain`.

- Runtime behavior is already conservative: `pause()` accepts only `running`,
  while `resume()` accepts only `paused` or `interrupted`. Therefore both commands
  return `invalid_transition` from this uncertain `waiting_user` state and cannot
  restart or repeat the external commit.
- Existing focused coverage proves the `resume` edge after a disconnect-time
  uncertain commit and also proves that the external commit ran only once:
  `keeps a disconnect-time commit uncertainty non-resumable`.
- The symmetric `pause` rejection is not asserted by a focused test. Cold-recovery
  coverage also verifies the uncertain state but does not dispatch pause/resume.

This is an evidence/test-coverage residual, not an observed runtime defect. Per
the run constraint, it is documented only: no runtime or test code was changed.

## Verification (Matt exit codes)

- Static inspection of `manager.ts` and `manager.test.ts`: residual confirmed.
- Focused Vitest command: exit **254** before test execution because this GNHF
  worktree has no `node_modules` (`Command "vitest" not found`). No test result is
  claimed from this iteration.

Stop here. Do not expand into W or a bare complex Bilibili agent task.

G1 closed pause evidence gap inside existing non-continuable test (manager 34/34).

## 2026-07-16 02:27 — pause edge CLOSED (G1)

- Asserted `pause` → `invalid_transition` on `waiting_user/commit_outcome_uncertain` inside manager non-continuable test.
- Matt: `pnpm -F chrome-extension test -- src/background/task/__tests__/manager.test.ts` → **34/34 exit 0**.

## Ticket 06 agent e2e residual (morning only)

- Unit residual closed for overnight.
- Agent golden still FAIL_honest; see `ticket-06-blocker.md`.
- Stop bare overnight e2e thrash.

# Scion-only GNHF stop note

Date: 2026-07-16

## Blocker: ticket 06 agent E2E needs the morning Owner

The bounded TaskManager unit residual is exhausted: soft-return, uncertain
`continue` / `follow_up`, optional-proof, approval-replay, and pause-edge evidence
are already covered, with the manager suite at 34/34 in the supplied handoff.
There is no further unit-only change to make in this run.

The next acceptance surface is ticket 06's real Feishu agent E2E. It requires
the morning Owner's daily authenticated Chrome session and a writable Feishu
URL so the run can prove all three observable outcomes:

1. zero submits before approval;
2. exactly one submit after approval; and
3. completion only from page success evidence.

No code was changed and no real-site result is claimed. **STOP here**; do not
expand into W or a bare complex task.
