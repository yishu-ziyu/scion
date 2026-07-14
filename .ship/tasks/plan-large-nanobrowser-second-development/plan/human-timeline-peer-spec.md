# Peer-spec: Human-facing chat timeline

WARNING: Second spec was self-generated, not independent peer agent (peer dispatch not used this session).

## Agreement with host

- Root issue is presentation of `Actors` + raw `details`, not TaskManager.
- Fix at `handleTaskState` + `MessageList` + pure humanize module.
- Keep TaskStatusCard as status authority.
- History remapped at read time.

## Additional risks (peer pass)

1. **`appendMessage` persistence:** STEP_OK currently can persist planner prose that is useful; over-filtering loses "what it planned". Host light-process rule is correct - keep short prose.
2. **`content === '正在执行...'`:** fragile; must not leave dual sentinels after i18n.
3. **Retry CTA:** if implemented as full new task without clearing, may stack tasks - prefer resend follow-up only when `isFollowUpMode` / input enabled.
4. **i18n codegen:** `packages/i18n` may generate `lib/type.ts` - do not hand-edit generated files.
5. **Privacy:** failure detail must not dump full form field values; truncate details to 200 chars and rely on existing redaction if any.

## Divergences

None critical vs host. Peer emphasizes retry safety and i18n codegen.

## Disposition

- Retry safety → **patched into plan Story 3** (follow-up path only / focus input fallback).
- i18n codegen → **noted in plan Story 3**.
