HANDOFF|task=g3-engine-fail|status=delivered|files=projects/chijie-browser/chrome-extension/src/background/task/executor-start-error.ts,projects/chijie-browser/chrome-extension/src/background/task/manager.ts,projects/chijie-browser/chrome-extension/src/background/agent/backends/control-llm.ts,projects/chijie-browser/chrome-extension/src/background/agent/backends/nano.ts,projects/chijie-browser/chrome-extension/src/background/task/__tests__/executor-start-error.test.ts,projects/chijie-browser/chrome-extension/src/background/task/__tests__/manager.test.ts,reports/nanobrowser/overnight/engine-start-fail.md|tests=pnpm -F chrome-extension test -- src/background/task/__tests__/executor-start-error.test.ts:0; pnpm -F chrome-extension test -- src/background/task/__tests__/manager.test.ts:0|unverified=dist not rebuilt; no live side-panel recheck; uncertain UX button not added

# g3-engine-fail

## Root causes
1. **任务引擎启动失败**: setup errors thrown with Chinese i18n bodies misclassified as `executor_start_failed` (old regex only English tokens). Fixed via `classifyCreateExecutorError` + `markSetupError`.
2. **waiting_user + commit_outcome_uncertain without criterion-confirm**: **by design** — confirm only for `proof_required` + `user_confirmed`. Uncertain after mid-commit SW recovery / external commit. Documented; no product button this slice.

## Report
`reports/nanobrowser/overnight/engine-start-fail.md`

## Owner wake
`pnpm inject:personal && pnpm build` then reload extension (do not kill Chrome from agents).
