# BioChek Backend

## Biometric retention purge (required for LFPDPPP compliance)

The privacy notice shown to employees during enrollment states that biometric
data is automatically deleted after 5 years. This is only true if the purge
job actually runs — it does **not** run automatically; it must be scheduled
via the server's system crontab (not an in-process scheduler — see
`docs/superpowers/specs/2026-09-18-biochek-retention-design.md` §2.2 for why).

Add this to the server's crontab (same schedule as the existing backups):

```
0 3 * * * cd <ruta-al-repo>/biochek/backend && node scripts/purge-biometrics.js >> /var/log/biochek-purge.log 2>&1
```

Replace `<ruta-al-repo>` with the actual deploy path. Verify it's running by
checking `/var/log/biochek-purge.log` after the first scheduled run, or by
running `npm run purge` manually.
