# Known Issues

Tracked bugs not yet scheduled as a plan. No GitHub remote on this repo, so
this file is the ticket queue — add an entry here when a real bug is found
but deferred; turn it into a `docs/superpowers/plans/` plan when picked up.

## OPEN

### `listChecadas` uses UTC date comparison instead of Mexico City local day

**Found:** 2026-09-18, during final review of Plan 5 (exportador NOI).
**File:** `biochek/backend/src/controllers/checadasController.js` (`listChecadas`, the `desde`/`hasta` filter, ~line 78-85)

**Bug:** `WHERE c.timestamp >= $desde AND c.timestamp <= $hasta` compares a
plain date string against a `TIMESTAMPTZ` column — Postgres resolves the
bare date at UTC midnight, not Mexico City midnight. A checada logged at
20:00+ local time on the last day of the range lands past the UTC boundary
and gets silently dropped from the filtered result.

**Where this bites:** the Reportes admin page (`ReportesPage.jsx`) uses
this same `GET /api/checadas` endpoint with `desde`/`hasta` filters. An
admin filtering Reportes on a range and generating a NOI export
(`POST /api/exportaciones-noi`) for the *same* range gets two different
sets of checadas — the NOI export already fixed its own version of this
bug (`exportacionesNoiController.js`, commit `5d85727`) but `listChecadas`
was explicitly left untouched (out of scope for that merge).

**Fix:** extract the `AT TIME ZONE 'America/Mexico_City'` half-open bounds
logic from `exportacionesNoiController.js` into a shared helper (e.g.
`utils/mexicoCityDayBounds.js`), apply it in both `createExportacion` and
`listChecadas`. Avoids the two SQL copies of `'America/Mexico_City'`
drifting apart (currently also duplicated as `NOI_TIMEZONE` in
`noiExportFormat.js`).

**Severity:** Important, not Critical — no data loss (checadas still exist
in the DB, just excluded from a filtered view), but payroll-adjacent
numbers not matching between two screens is a real trust problem once
someone notices.

## RESOLVED

### Consent checkbox on `PrivacyConsentScreen` has no accessibility semantics

**Found:** 2026-09-18, during final review of Plan 6 (retención y seguridad).
**Fixed:** 2026-09-19 — added `accessibilityRole="checkbox"` and
`accessibilityState={{ checked }}` to the `Pressable` at
`PrivacyConsentScreen.tsx`.
