HANDOFF|task=g3-wait-afford|status=delivered|files=projects/chijie-browser/pages/side-panel/src/presentation/wait-affordance.ts,projects/chijie-browser/pages/side-panel/src/presentation/__tests__/wait-affordance.test.ts,projects/chijie-browser/pages/side-panel/src/components/TaskStatusCard.tsx,projects/chijie-browser/pages/side-panel/src/design/__tests__/ui-acceptance.test.ts,projects/chijie-browser/chrome-extension/src/background/task/manager.ts,projects/chijie-browser/chrome-extension/src/background/task/__tests__/manager.test.ts,projects/chijie-browser/packages/i18n/locales/{zh_CN,zh_TW,en,pt_BR}/messages.json,reports/nanobrowser/overnight/wait-afford.md|tests=wait-affordance:0;ui-acceptance -t waiting_user non-proof:0;manager:0;commit-recovery.integration:0|unverified=dist not rebuilt; full ui-acceptance 3 pre-existing i18n stack overflows; no live Feishu recheck

# g3-wait-afford

## Done
- Non-proof `waiting_user` shows `data-testid=wait-continue` or `wait-retry` (uncertain).
- Button sends `resume`; TaskManager accepts waiting_user resume, clears waitReason, re-runs driver/loop.
- proof_required still uses criterion-confirm only.
- Report: `reports/nanobrowser/overnight/wait-afford.md`
