# Dev Context

## Test Command

`pnpm -F chrome-extension test -- src/background/browser/__tests__/context.test.ts`

## Test Seams

- `BrowserContext.getCurrentPage()` — observable selected page.
- `BrowserContext.getTabInfos()` — observable tabs exposed to agents.
- Mock only the Chrome Tabs API boundary; use real `BrowserContext`, `Page`, and URL policy.

## Code Conduct

- pnpm/Vitest/TypeScript; minimal scoped diff; no new dependency.
- Reuse `isUrlAllowed()`; do not duplicate scheme rules.
- Do not edit generated output or expose secrets.

## Pattern References

- `chrome-extension/src/background/browser/context.ts`
  - Owns target selection and BrowserState tab inventory.
- `chrome-extension/src/background/browser/util.ts`
  - Existing authoritative URL/firewall policy already blocks `chrome-extension://`.
- `chrome-extension/src/background/services/guardrails/__tests__/guardrails.test.ts`
  - Existing Vitest naming, imports, and assertion style.

## Waves

One vertical story, sequential: red regression test → minimal `BrowserContext` fix → full verification.

## Verification

- Red → green: settled extension tabs, allowed pending web URLs, and pending extension URLs.
- `pnpm -F chrome-extension test`: 20/20 pass.
- Targeted ESLint: pass.
- `pnpm build`: pass.
- Type-check: only the pre-existing `agent/helper.ts:24` `completionWithRetry` error remains.
- Peer review: fail after two targeted fix rounds. The unresolved mixed transition is committed `chrome-extension://` plus pending HTTPS; a red diagnostic confirmed inventory and cold-selection violations.
