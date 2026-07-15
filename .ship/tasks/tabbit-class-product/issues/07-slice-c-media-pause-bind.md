# 07 — Slice C: media continuous control (pause this)

**What to build:** After media is playing on a content tab, user says **pause this** (or Chinese equivalent); agent binds the **same tab/media object**, pauses with evidence, new completion receipt. Same core as Slice A.

**Blocked by:** 03 — Slice A YouTube E2E

**Status:** ready-for-agent

**Seams:** S4, S2, S5

- [ ] Follow-up round binds prior media/tab (continuous control)
- [ ] Pause verified on page/media state (not model text alone)
- [ ] Works for HTML5 media path; Bilibili when Owner login available
- [ ] Evidence note in reports; no false complete if still playing
