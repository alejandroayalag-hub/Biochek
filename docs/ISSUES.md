# Known Issues

Tracked bugs not yet scheduled as a plan. No GitHub remote on this repo, so
this file is the ticket queue — add an entry here when a real bug is found
but deferred; turn it into a `docs/superpowers/plans/` plan when picked up.

## OPEN

(none open)

## RESOLVED

### `listChecadas` uses UTC date comparison instead of Mexico City local day

**Found:** 2026-09-18, during final review of Plan 5 (exportador NOI).
**Fixed:** 2026-09-19 — extracted the `AT TIME ZONE 'America/Mexico_City'`
half-open bounds logic into `biochek/backend/src/utils/mexicoCityDayBounds.js`,
applied it in both `checadasController.js` (`listChecadas`) and
`exportacionesNoiController.js` (`createExportacion`), and pointed
`noiExportFormat.js`'s `NOI_TIMEZONE` at the same constant so all three
can no longer drift apart. `listChecadas` also gained the same
`YYYY-MM-DD` validation `createExportacion` already had (400 instead of a
raw Postgres error on a malformed `desde`/`hasta`).

### Consent checkbox on `PrivacyConsentScreen` has no accessibility semantics

**Found:** 2026-09-18, during final review of Plan 6 (retención y seguridad).
**Fixed:** 2026-09-19 — added `accessibilityRole="checkbox"` and
`accessibilityState={{ checked }}` to the `Pressable` at
`PrivacyConsentScreen.tsx`.
