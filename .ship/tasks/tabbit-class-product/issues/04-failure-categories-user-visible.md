# 04 — User-visible failure categories

**What to build:** When a task fails, the side panel shows a **plain failure category** (e.g. login wall, selector/target miss, false complete, model loop, other)—not raw engineer stack noise—so the user knows what happened.

**Blocked by:** 01 — Task mode + steps + done UI

**Status:** ready-for-agent

**Seams:** S1, S2

- [ ] Failed tasks map to a fixed category vocabulary (aligned with product reports)
- [ ] UI shows category on the task card / status surface
- [ ] Tests cover mapping from known failure kinds to labels
- [ ] Does not require Slice A YouTube to merge (can ship after 01)
