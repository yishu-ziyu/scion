# 01 — Task mode + steps + done UI (Tabbit panel shape)

**What to build:** In the extension side panel, the user works in **task mode**, sees a **human-readable execution step list** while a task runs, and sees a **verified done** state (optional success / partial / fail rating). No Planner/Navigator/`step_failed` as primary copy. A scripted or fixture-driven task is enough to demo the full surface.

**Blocked by:** None — can start immediately.

**Status:** implemented (pending Owner UI smoke)

**Seams:** S1 (primary), S2 events

- [x] Task mode is the clear primary path for agent goals in the side panel
- [x] Steps appear in plain language as the task progresses (collapsible OK)
- [x] Done UI only when completion is verified (or scripted fixture marks verified)
- [x] Optional post-task rating: success / partial / fail
- [x] UI acceptance tests cover jargon-free labels and rating controls
- [x] Demoable without real YouTube (fixture/scripted steps OK)

**Evidence:** side-panel tests 40/40; branch `feature/ticket-01-task-mode-ui`
