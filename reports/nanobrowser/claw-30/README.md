# Claw 30 live evidence

SSOT scorecard: `docs/product/018-claw-30-live-scorecard.md`

Per-case folder: `claw-30/<ID>/` with `notes.md` + screenshots/logs.

Updated: 2026-07-24  
pass=0 partial=0 fail=0 auto_proxy=1 (O1 form-journey) not_run=29

## Progress note (2026-07-24)

- O1: unit form-journey still `auto_proxy`; Claw/e2e story not green.
- Prior e2e failure: empty attempts + `waiting_user`/`proof_required` because fixture `<script>` literal `"Saved successfully"` was scanned as live page success (false complete before fill).
- Fix direction: `pageHtmlShowsFormSuccess` strips script (or use body innerText). Re-run e2e before any status raise.
- design/006 linked from `docs/DOCS_INDEX.md`.
