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

### Consent checkbox on `PrivacyConsentScreen` has no accessibility semantics

**Found:** 2026-09-18, during final review of Plan 6 (retención y seguridad).
**File:** `biochek/mobile/src/screens/PrivacyConsentScreen.tsx` (the checkbox `View`/`Pressable`, ~line 57-60)

**Bug:** the consent checkbox is a bare `View` inside a `Pressable`, with no
`accessibilityRole="checkbox"` or `accessibilityState={{ checked }}`. A
screen-reader user gets no indication it's a checkbox, or of its current
checked/unchecked state.

**Why this one matters more than a typical a11y gap:** this control is the
actual informed-consent mechanism for enrolling biometric data (LFPDPPP) —
the entire point of Plan 6 was making consent real instead of a rubber-stamped
boolean. A screen-reader user who can't perceive the checkbox's state can't
meaningfully give that consent, even though the feature "works" for a sighted
user.

**Fix:** add `accessibilityRole="checkbox"` and `accessibilityState={{ checked }}`
to the `Pressable` at `PrivacyConsentScreen.tsx:57`.

**Severity:** Important (compliance-adjacent), not Critical — the feature
functions correctly for the common case, but this is a real accessibility/
consent gap, not polish. Flagged by the final-review reviewer as "escalate
soonest after merge."
