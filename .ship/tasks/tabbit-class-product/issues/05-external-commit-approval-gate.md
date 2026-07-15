# 05 — External-commit-only approval gate

**What to build:** Actions classified as **external commit** stop for **one-use approval**; navigate/read/reversible media do not. Zero unapproved external commits. Verifiable on a **local form fixture** (fill → wait approve → single submit → evidence).

**Blocked by:** 01 — Task mode + steps + done UI

**Status:** ready-for-agent

**Seams:** S2 (primary), S1 for approve UI

- [ ] Non-commit actions never open the approval gate
- [ ] Commit actions cannot execute without a one-use approval token
- [ ] After approve, exactly one commit attempt path (no double-submit without new approval)
- [ ] Fixture journey tests pass (form fixture prior art)
- [ ] UI copy for waiting / approved / rejected is human-readable
