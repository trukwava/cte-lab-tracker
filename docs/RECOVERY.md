# Local SQLite backup and restore runbook

**Scope:** fictional one-machine demo and local pilot only. Backups may contain account password hashes, hashed session tokens, borrower codes and audit history. Treat them as sensitive; store outside GitHub, use encrypted offline storage and restrict permissions. Do not put real student or school data in this app.

Node.js 22.16+ is required for the built-in online SQLite backup API (a consistent snapshot including uncheckpointed WAL data). The app may be running while you back up; the restore destination must be a **new file**, used after the server is stopped.

## Backup

In the project directory, with the same `DB_FILE` and `AUTH_MODE` used by the server:

```bash
AUTH_MODE=pilot npm run db -- backup /secure/backups/riverton-2026-10-30.sqlite
AUTH_MODE=pilot npm run db -- verify /secure/backups/riverton-2026-10-30.sqlite
```

The script refuses to overwrite an existing destination, creates a consistent SQLite snapshot, runs `quick_check` and `foreign_key_check`, and prints a SHA-256 digest plus aggregate counts. It does not log credentials, borrower identifiers, or raw rows. On Unix systems the backup is restricted to mode `0600`. The file is not encrypted by this script.

Optional `DB_FILE=/custom/path/riverton-pilot.sqlite` must match the application’s configured database. Default is `data/riverton-pilot.sqlite` for `AUTH_MODE=pilot` and `data/riverton-demo.sqlite` for default demo mode.

## Restore to a clean location

1. **Stop the application**; record the prior database path and back it up separately. Do not restore over the live database.
2. Verify the backup independently before making it a source of truth.
3. Restore to a **new destination path**. The command refuses to overwrite or replace a file.
4. Point `DB_FILE` to that new path, restart on loopback, and verify the Today screen and important audit records.
5. In pilot mode, sign in again. The restore **revokes archived sessions** while retaining account password hashes and role assignments.

```bash
AUTH_MODE=pilot npm run db -- verify /secure/backups/riverton-2026-10-30.sqlite
AUTH_MODE=pilot npm run db -- restore /secure/backups/riverton-2026-10-30.sqlite /secure/recovered/riverton-recovered.sqlite
AUTH_MODE=pilot DB_FILE=/secure/recovered/riverton-recovered.sqlite npm start
```

The output SHA-256 digest on restore intentionally differs from the source backup because saved sessions are removed. Use counts and the integrity checks as the initial verification; test the operational workflow and audit log after recovery.

## Limits

- A successful integrity check is not proof of complete application-level correctness, provenance, or regulatory compliance. Test actual recovery regularly.
- There is no scheduler, offsite retention, encryption/key management, remote backup, hosted database, or documented recovery-time guarantee.
- An ordinary demo reset irreversibly replaces Riverton synthetic records; backup before reset if the edits matter. The reset is refused if another lab exists in that SQLite database.
- The application still refuses non-loopback network binding, and this runbook does not authorize public hosting or real school records.
