# ego-lite → 持节 Snapshot Frame 验证记录

Date: 2026-07-30  
Scope: `product/014` B2 Perception + G7 privacy regression  
Design: `docs/design/007-ego-lite-snapshot-frame.md`

## Outcome

- Added one immutable Snapshot Frame identity for each interactive observation.
- Automatically bound index-based control actions to the frame that supplied the index.
- Routed the frame identity through Page → TaskManager → ActionDispatcher, reusing the existing pre-mutation stale reject.
- Redacted arbitrary intent text from persisted external-commit display summaries after the full suite exposed a G7 failure.

## Source basis

Read the 2026-07-30 `citrolabs/ego-lite` main snapshot at `f260b21761354ca0d2781ce750418305f16f8988`, especially:

- `package/ego-browser/src/ref-map.ts`
- `package/ego-browser/src/ref-state.ts`
- `package/ego-browser/src/element-resolver.ts`
- `package/ego-browser/src/helpers.ts`
- `package/ego-browser/src/learning/`

No ego-lite code was copied. The adopted behavior is the short-lived snapshot/ref invariant.

## Verification

```text
pnpm -F chrome-extension test -- \
  src/background/task/__tests__/action-frame.test.ts \
  src/background/browser/__tests__/action-target.test.ts \
  src/background/task/__tests__/action-dispatcher.test.ts \
  src/background/agent/backends/__tests__/control-policy.test.ts

PASS: 4 files, 75 tests
```

```text
pnpm -F chrome-extension test

PASS: 40 files, 348 tests
```

```text
pnpm build

PASS: 5 build tasks; dist/ regenerated
```

The first full run surfaced one pre-existing G7 failure: an external-commit intent containing `secret form value` was persisted into `displaySummary`. The fix makes approval-gated actions ignore arbitrary intent in persisted display copy and use the semantic target label instead. The final full run passed 348/348.

## Known baseline / unverified

- `pnpm -F chrome-extension type-check` is still red on pre-existing test-double typings and `ChatOpenAI.completionWithRetry`; none of the reported diagnostics point to this slice.
- Real dynamic-page Chrome E2E has not yet been run for stale-frame rejection.
- `pnpm --filter chrome-extension e2e:action-agent` could not load the extension into Chrome Stable. The documented `CDP_URL=http://127.0.0.1:9222` retry also stopped before connection because `/json/version` returned 404. Read-only `chrome-cdp status` reported `listen: yes`, `targets: 0`, `health: BAD` with a stale `DevToolsActivePort` from 2026-07-23. No repair was attempted because it would restart the Owner's main Chrome; no connected-store reset occurred.
- This does not change the Claw 30 scorecard: it is runtime hardening, not a story-level pass.
