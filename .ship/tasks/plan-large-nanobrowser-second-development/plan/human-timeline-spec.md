# Spec: Human-facing chat timeline (hide machine roles)

**Task:** `plan-large-nanobrowser-second-development`  
**Slice:** human-timeline  
**Status:** ready for plan/dev  
**Date:** 2026-07-14  
**Defaults locked by owner:** light process (1B) · failure + actions + collapsible detail (2B) · paper card is primary status (3A)

## Problem

Side panel chat paints raw agent telemetry:

- `ACTOR_PROFILES` shows **Planner / Navigator / Validator** names (`pages/side-panel/src/types/message.ts`).
- `handleTaskState` appends messages with `actor` + `data.details` for `STEP_OK` / `STEP_FAIL` (`SidePanel.tsx` ~212-291).
- Failures often surface as English enums/phrases (`step_failed`, parse errors) instead of Chinese human copy.
- Progress uses a magic string `正在执行...` (`MessageList.tsx` ~37) with the same machine actor header.

This violates `product/06-experience-spec.md` (loading shows intent; recoverable error explains + offers retry).

Backend Planner/Navigator **stay**. Only **presentation** changes.

## Goals

1. Default UI never shows labels: Planner, Navigator, Validator, Manager, Evaluator, or raw `step_failed` / `step.fail` / similar enum tokens as primary text.
2. Visible chat roles: **你** (user) and **助手** (assistant/system/agent stream).
3. Running: at most **one** live progress bubble with human intent text (updatable), not a stack of STEP_START lines.
4. Failure: **one** consolidated bubble with human reason + CTAs (retry / rephrase); technical detail behind expand (still no raw enum as title).
5. `TaskStatusCard` remains the **primary** status surface (running / waiting / failed / completed). Chat does not duplicate full status chrome.
6. Optional later: settings flag "显示开发轨迹" - **out of this slice** unless trivial; default off.

## Non-goals

- Changing TaskManager / Executor / completion evidence contracts.
- Redesigning Options page or Skill editor.
- Full chat redesign (markdown, streaming tokens).
- Storing raw model payloads in chat history.
- Removing Actors from storage schema (keep for history compatibility; map at display and at write for new messages).

## Domain language (user-visible)

| Term | Meaning |
|------|---------|
| 助手 | All non-user, non-debug agent/system speech |
| 进行中 | Task is executing; paper card + one progress line |
| 这一步没做成 | Step-level failure, may still retry |
| 这次任务失败了 | Terminal task failure (card + one summary) |
| 详情 | Collapsed technical summary for support/logs |

Banned as primary UI: `step_failed`, `STEP_FAIL`, `Planner`, `Navigator`, `validateModelOutput`, raw English stack unless inside 详情.

## Current code seams (traced)

| Seam | Path | Role |
|------|------|------|
| Event switch | `pages/side-panel/src/SidePanel.tsx` `handleTaskState` | Decides skip / progress / append |
| Persist filter | `pages/side-panel/src/event-persistence.ts` | Already drops ACT_* from durable chat |
| Message shape | `packages/storage/lib/chat/types.ts` `Message` | `actor` + `content` + `timestamp` only |
| Render | `pages/side-panel/src/components/MessageList.tsx` | Renders actor profile name + content |
| Profiles | `pages/side-panel/src/types/message.ts` `ACTOR_PROFILES` | English role names |
| Status card | `pages/side-panel/src/components/TaskStatusCard.tsx` | Human status keys already exist |
| i18n | `packages/i18n/locales/*/messages.json` | `chat_task_status_*`, `chat_task_hint_*` |

## Behavior contract

### Display model

Introduce a **presentation layer** (pure functions, unit-tested) that maps:

```text
AgentEvent | stored Message  →  DisplayMessage
```

`DisplayMessage` (UI-only; may not all be persisted as-is):

- `kind`: `user` | `assistant` | `progress` | `failure` | `system_note`
- `title`: always human (你 / 助手) - never Planner
- `body`: human Chinese (or empty for pure progress bar)
- `detail?`: optional technical string for expand
- `actions?`: `retry` | `rephrase` | none
- `ephemeral?`: progress may replace previous progress in the same run

### Event policy (new messages)

| Event | UI policy |
|-------|-----------|
| USER message | show as 你 |
| PLANNER/NAVIGATOR/VALIDATOR STEP_START | **do not** append a new durable line; update single progress bubble with generic or mapped intent |
| STEP_OK with useful `details` | optional light process: one short human paraphrase if `details` looks like prose; **skip** pure machine tokens; collapse into assistant note max 1 per step burst |
| STEP_FAIL | translate → single failure bubble (merge consecutive fails within e.g. 3s into one) |
| TASK_OK / completed | prefer TaskStatusCard; chat may show short success if content is human |
| TASK_FAIL | one failure summary; card shows 失败了 |
| ACT_* | stay non-durable (already) |
| progress magic `正在执行...` | replace with i18n key; render without Planner header |

### Translation of failures (examples)

| Signal in `details` (match) | User body (zh) | Detail (optional) |
|----------------------------|----------------|-------------------|
| extract JSON / manuallyParse / validateModelOutput | 这一步没做成：模型返回的内容读不出来。 | first 200 chars of details |
| RequestCancelled / aborted | 这次操作被中断了。 | details |
| login_required / captcha | reuse `chat_task_hint_*` | - |
| generic / empty | 这一步没做成。可以再试一次，或换个说法。 | details |

CTAs:

- **再试一次** → resend last user instruction (existing session follow-up) or soft "tell user to resend" if no safe API - prefer invoke same text if we still have last USER message.
- **换个说法** → focus chat input (no auto-send).

### Historical messages

When loading old sessions with `actor: planner` and content `step_failed`:

- Render via same mapper: title 助手, body translated, never show Planner label.
- Do not migrate storage in v1 unless cheap; mapping at read is enough.

### Paper card (3A)

- Keep `TaskStatusCard` as sole place for status enum → human (`statusLabelKey`).
- Chat failure bubble should not re-show full status chrome; one sentence is enough.
- When `waiting_approval`, card remains primary; chat should not spam step events.

### Accessibility / i18n

- All new strings in zh_CN + en (and existing locales if cheap).
- No hard-coded English role names in UI.

## Acceptance criteria

1. Reproduce a MiniMax parse failure run: visible chat has **zero** occurrences of the substrings `PLANNER`, `NAVIGATOR`, `step_failed`, `step.fail` (case-insensitive) in the default view (excluding expanded 详情 if we put raw text only there - prefer redacting enum even in detail title).
2. During running, at most one progress indicator line in the chat list (not N planner/navigator starts).
3. Failure shows Chinese sentence + at least one actionable control (retry or rephrase).
4. Unit tests cover: map STEP_FAIL parse error → human body; map historical planner/step_failed message → human; progress not labeled Planner.
5. `pnpm -F @extension/sidepanel test` green; build side-panel green.
6. TaskStatusCard still shows 进行中/失败了 for task snapshot states.

## Test seams

- Pure module e.g. `pages/side-panel/src/presentation/humanize-message.ts` (name flexible):
  - `humanizeStoredMessage(msg) → DisplayMessage`
  - `humanizeAgentEvent(event) → DisplayUpdate | null` (null = suppress)
  - `mergeFailure(prev, next) → DisplayMessage`
- Vitest in side-panel `__tests__/humanize-message.test.ts` (or design/__tests__).
- Optional: light component test that MessageList does not render "Planner" for planner actor when using humanized props.

## Risks

| Risk | Mitigation |
|------|------------|
| Losing debug info in UI | 详情 + `nanobrowser-logs` CDP path |
| Over-suppressing useful STEP_OK plans | Allow short prose STEP_OK as light process; filter enums |
| History looks odd after change | Read-time map all non-user actors → 助手 |
| Retry double-fires tasks | Retry only inserts user message path already used for send; no new Task API in v1 if unsafe - then "换个说法" only for CTA |

## Investigation notes

- `shouldPersistExecutionEvent` still true for STEP_FAIL → failures remain in history; good for remapping.
- No need to change background emit shape in v1 if UI translation is sufficient.
- Magic progress string coupling is brittle; move to i18n + kind=progress.

## Out of scope follow-ups

- Developer trajectory toggle in Options.
- Streaming token UI.
- Merging TaskStatusCard into chat (explicitly rejected for this slice - 3A).
