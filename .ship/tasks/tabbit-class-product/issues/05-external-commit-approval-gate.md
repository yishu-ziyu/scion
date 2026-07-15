# 05 — External-commit-only approval gate

**What to build:** Actions classified as **external commit** stop for **one-use approval**; navigate/read/reversible media do not. Zero unapproved external commits. Verifiable on a **local form fixture** (fill → wait approve → single submit → evidence).

**Blocked by:** 01 — Task mode + steps + done UI

**Status:** implemented (tests + existing approval UI)

**Seams:** S2 (primary), S1 for approve UI

- [x] Non-commit actions never open the approval gate (`go_to_url` journey)
- [x] Commit actions cannot execute without a one-use approval token (form journey)
- [x] After approve, exactly one commit attempt path (single submit)
- [x] Fixture journey tests pass
- [x] UI copy for waiting / approved / rejected is human-readable (ticket 01 TaskStatusCard)

**Artifacts:** `control-backend-journey` ticket 05 case
