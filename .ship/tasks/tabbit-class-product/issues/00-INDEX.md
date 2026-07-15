# Tickets index — tabbit-class-product

**Parent spec:** `.ship/tasks/tabbit-class-product/spec/SPEC.md`  
**Parent issue:** https://github.com/yishu-ziyu/scion/issues/1  
**Seams:** S1–S5 accepted  
**Matt:** `/to-tickets` · work frontier with `/implement` + `/tdd`, clear context between tickets

## Graph

```text
01 task UI ─────────────┬──► 02 observe-act loop ──► 03 Slice A YouTube E2E ──┬──► 06 Slice B Feishu
                        │                                                      └──► 07 Slice C media
                        ├──► 04 failure categories
                        └──► 05 external-commit approval ─────────────────────► (also blocks 06)
```

## Status

Tickets **01–05** implemented. Remaining frontier:

| ID | Title | Blocked by | GitHub |
|----|--------|------------|--------|
| **06** | Slice B Feishu | 03, 05 | #7 |
| **07** | Slice C media pause | 03 | #8 |

## Done

| ID | Title | Status |
|----|--------|--------|
| 01 | Task mode + steps + done UI | implemented |
| 02 | Observe→act loop navigate | implemented |
| 03 | Slice A YouTube E2E | implemented (protocol + runner; live MiniMax may need Owner reload) |
| 04 | Failure categories | implemented |
| 05 | External-commit approval | implemented |

## Out of these tickets

Cross-conversation memory, 妙招广场, full browser, multi-model shelf, Python browser-use default.
