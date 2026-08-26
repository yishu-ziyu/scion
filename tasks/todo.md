# Tasks: Agent execute loop

- [x] Task 1: `collectInteractive` 报告进不去的 iframe
  - Acceptance: attach 失败列入 `inaccessibleIframes`，节点列表不含假装存在的子框控件
  - Verify: `pnpm -F chrome-extension test -- src/background/browser/cdp/__tests__/collect.test.ts`
  - Files: `collect.ts`, `collect.test.ts`, `cdp/index.ts`

- [x] Task 2: 观察帧带上失败 iframe；策略不得当表已完整
  - Acceptance: `ObservationFrame.inaccessibleIframes` 非空时，不得 `done`；填表动作被拒绝或 `waiting_user`
  - Verify: `pnpm -F chrome-extension test -- src/background/browser/kernel src/background/agent/backends/__tests__/control-policy.test.ts`
  - Files: `views.ts` 或 `types.ts`, `observation.ts`, `dom/service.ts`, `control-policy.ts`, tests
  - Depends: Task 1

- [x] Task 3: 邮箱打开策略（问 / 点名 / 已确认常用）
  - Acceptance: 无 URL 无点名无确认 → ask；「打开谷歌邮箱」→ `https://mail.google.com`；确认后才记住 host
  - Verify: `pnpm -F chrome-extension test -- src/background/agent/__tests__/mailbox-open.test.ts`
  - Files: `agent/mailbox-open.ts`, test

- [x] Task 4: 登录墙强制停
  - Acceptance: 观察是登录墙时 `waiting_user`/`login_required`，不往密码框 `input_text`
  - Verify: `pnpm -F chrome-extension test -- src/background/agent/backends/__tests__/control-policy.test.ts`
  - Files: `control-policy.ts`, tests
  - Depends: Task 2

- [x] Task 5: 真 Chrome iframe e2e
  - Acceptance: `pnpm e2e:action-agent` 打开跨源 iframe 夹具，子框字段被填上；所需 iframe skip 则失败
  - Verify: `pnpm e2e:action-agent`
  - Files: `action-agent-e2e.mjs`, fixtures, `package.json` 注释可保留同一命令
  - Depends: Task 1, 2

## Checkpoint: After Tasks 1-4
- [x] 聚焦单测通过
- [x] `pnpm -F chrome-extension type-check` 通过

## Checkpoint: Complete
- [x] SPEC Success Criteria 5–8 有对应测试
- [x] 真 Chrome iframe 场景：`[e2e] run0 iframe-shadow PASS`（子框 card 被填上）
- [x] 018-O1 `invalid_run` / `evidence_protocol` 修复 → 交付文档 `docs/specs/2026-08-26-e2e-gap-handoff.md` 任务 A（2026-08-26 完成：`EVAL_TASK_ID=018-O1 RUNS=1 pnpm -F chrome-extension e2e:action-agent` exit 0，`outcome=verified_pass`）
- [x] SW 重启后行为不变的 e2e 场景 → 同文档任务 B（2026-08-26 完成：`pnpm -F chrome-extension e2e:sw-restart` exit 0，RUNS=3 稳定）
