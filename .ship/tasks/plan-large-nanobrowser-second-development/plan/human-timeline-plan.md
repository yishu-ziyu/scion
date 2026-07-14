# Plan: Human-facing chat timeline

**Spec:** `plan/human-timeline-spec.md`  
**Defaults:** 1B light process · 2B failure+CTA+detail · 3A card primary status

## Story 0 - Red tests for humanize pure functions (TDD)

**Files:**  
- add `pages/side-panel/src/presentation/humanize-message.ts`  
- add `pages/side-panel/src/presentation/__tests__/humanize-message.test.ts`

**Steps:**

1. Write failing tests:
   - `humanizeStoredMessage({ actor: 'planner', content: 'step_failed' })` → title 助手, body Chinese, body does not include `step_failed` as sole content.
   - `humanizeStoredMessage({ actor: 'navigator', content: 'Could not manually extract JSON...' })` → parse-failure copy.
   - `humanizeAgentEvent(STEP_START)` → progress update, not durable spam policy helper returns `kind: 'progress'`.
   - `humanizeAgentEvent(STEP_FAIL parse)` → `kind: 'failure'` with detail optional.
   - Assert no output title equals `Planner` / `Navigator`.
2. Implement minimal pure functions + string tables (zh hardcode ok only if i18n wired same commit).
3. `pnpm -F @extension/sidepanel test` green for these tests.

**Done when:** tests pass without MessageList changes yet.

---

## Story 1 - Wire MessageList to display model

**Files:**  
- `pages/side-panel/src/components/MessageList.tsx`  
- `pages/side-panel/src/types/message.ts` (optional: human profile for assistant)

**Steps:**

1. MessageList maps each `Message` through `humanizeStoredMessage` before render.
2. Render title from display model (你 / 助手), not `ACTOR_PROFILES[actor].name` English.
3. Progress: if content is progress sentinel or kind progress, show bar without machine name.
4. Failure: if kind failure, show body + optional `<details>` for technical detail (no enum as heading).
5. Keep layout within yishu tokens (existing classes).

**Done when:** loading historical planner/step_failed messages in UI would show human copy (manual or storybook-less visual check).

---

## Story 2 - Event pipeline: suppress spam, merge fails, one progress

**Files:**  
- `pages/side-panel/src/SidePanel.tsx` `handleTaskState`  
- optionally small helper next to humanize

**Steps:**

1. STEP_START: do not append durable planner/navigator lines; maintain one in-memory progress message (replace last progress or single progress id).
2. STEP_OK: if details look like machine token only, skip; if human prose, append as assistant (optional light process) max rate-limit 1 per few seconds.
3. STEP_FAIL: call humanize; if last chat message is failure within short window, replace/merge instead of append.
4. Stop using bare `progressMessage = '正在执行...'` as actor-labeled content; use i18n + humanize.
5. Do not change TaskStatusCard behavior except ensuring no duplicate dependency on raw chat actors.

**Done when:** simulated event sequence in unit test of pure policy (preferred) or manual: one progress, one merged failure.

---

## Story 3 - i18n + CTAs

**Files:**  
- `packages/i18n/locales/zh_CN/messages.json` (+ en, and zh_TW/pt_BR if required by package)  
- MessageList or small FailureActions component  
- SidePanel handlers for retry/rephrase

**Steps:**

1. Add keys e.g. `chat_human_progress`, `chat_human_fail_parse`, `chat_human_fail_generic`, `chat_human_fail_aborted`, `chat_human_retry`, `chat_human_rephrase`, `chat_human_assistant`, `chat_human_you`, `chat_human_detail`.
2. Retry: resend last user message text via existing send path if available; else focus input.
3. Rephrase: focus textarea / chat input.
4. Ensure generated i18n types regenerated if project requires (`pnpm` script used by repo).

**Done when:** failure bubble shows Chinese buttons; no English Planner.

---

## Story 4 - Acceptance lock + build

**Files:**  
- extend `pages/side-panel/src/design/__tests__/ui-acceptance.test.ts` or humanize tests  
- build side-panel

**Steps:**

1. Contract test: MessageList source uses humanize module; ACTOR_PROFILES English names not used as sole label path (grep MessageList for `actor.name` English profiles).
2. `pnpm -F @extension/sidepanel test`  
3. `pnpm -F @extension/sidepanel build`  
4. Note in `reports/nanobrowser/` or task concerns: manual Chrome check - fail run shows human copy.

**Done when:** automated gates green; manual checklist written in plan completion note.

---

## Implementation order

```text
Story 0 → 1 → 2 → 3 → 4
```

No parallel app edits required; pure module first.

## Rollback

Revert presentation wiring; storage schema unchanged so history remains readable.

## Explicit non-steps

- No background agent refactor.
- No Options "debug trajectory" unless leftover time after Story 4.
