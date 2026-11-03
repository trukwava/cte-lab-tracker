# PostgreSQL operational migration — offline preparation (November 2026)

**Status: export and proposed schema only. Not a PostgreSQL-backed application or an authorized production migration.** The live server still uses local SQLite and refuses non-loopback network binding. No PostgreSQL server, driver, hosted database, real tenant, or institutional account is connected.

## What this increment delivers

1. `migrations/postgres/001_operational.sql` is a candidate PostgreSQL schema for **19 operational tables**. It retains the partial unique index enforcing at most one active loan per asset and the unique open-quarantine index. Composite `(lab_id, foreign_id)` references protect asset/location, borrower/loan, vendor association, purchase, loan return location, maintenance policy and import links. The cycle between an asset and its current maintenance policy uses a deferred foreign key.
2. `src/postgres-migration.ts` takes an **online, consistent SQLite backup**, verifies SQLite integrity and foreign keys, validates ownership relationships, then writes a private create-only directory containing one deterministic NDJSON file per table, plus a count/SHA-256 manifest. It does not mutate the source database.
3. The projection adds **derived `lab_id` columns** to dependent records previously relying on joins to find their lab. It retains prior event IDs, timestamps, raw/normalized import provenance, and audit details, and decodes JSON fields into JSON objects for `jsonb` columns.
4. All local pilot identity tables—`local_accounts`, `local_sessions`, `lab_memberships`, and `organization_memberships`—are **excluded**; importing their local password hashes and cookies into a hosted identity system would be unsafe. A later reviewed provisioning process must map actual users to authorized organizations and labs. No live auth identity migration is promised.

## Run locally with synthetic records

With Node.js 22.16+ and the server stopped or running (online SQLite snapshot is used):

```bash
npm run pg:migrate -- export ./data/riverton-demo.sqlite /private/path/cte-operational-snapshot
npm run pg:migrate -- verify /private/path/cte-operational-snapshot
```

The destination **must not exist** and must be **outside the source repository**. It is created mode `0700`; files are mode `0600`. The exporter refuses corruption, orphaned references, tenant mismatches and unexpectedly large (>128 MiB) single-table output. It writes only to its new destination; on failure it removes incomplete output. The SHA-256 checks detect unintended changes between export and verification, **not** a malicious attacker who can also rewrite the manifest (these hashes are not signatures).

**Handle the output as sensitive.** Source CSV, service notes, audit actor identifiers, and operational history are retained. Do not commit or attach exports publicly. Do not export or import authentic school records until the production security and retention controls are reviewed.

## Proposed, not yet executed, PostgreSQL import procedure

A future reviewed loader must connect to a *new, empty*, permission-restricted PostgreSQL database and:

1. Provision tenant identities through a production identity provider and administrative review; do not restore local pilot password hashes or sessions.
2. Apply the candidate schema in a transaction. Conduct PostgreSQL-engine DDL and schema validation **before** production use; CI currently checks its declared structure only and does not execute it against PostgreSQL.
3. Validate manifest and file hashes; use parameterized inserts or a safe staging-table loader (NDJSON is **not** directly a `COPY` table format). Load the 19 tables in manifest order, within a transaction; defer the asset-current-plan circular foreign key until commit.
4. Reconcile table counts, tenant IDs, active-loan uniqueness, maintenance plan/version links, per-lab asset counts and audit-event continuity. Reset identity sequences using the maximum imported IDs before new inserts.
5. Test both independent tenants with denied cross-org queries and writes; implement DB-level RLS or an independently reviewed equivalent, production authorization, backups and restore drills; then run concurrent checkout tests against the **actual PostgreSQL adapter**.
6. Keep SQLite as the default until a separately reviewed persistence adapter can serve the application with equivalent transactional, authorization and audit guarantees.

### Deliberately not delivered

- No PostgreSQL connection, data upload, deployment, or driver dependency; no automatic import into a live database.
- No complete PostgreSQL runtime adapter, database-level RLS policies, or hosted operational safety review.
- No conversion of test fixtures into real school data, procurement authorization or equipment safety certification.

## Verification

`npm test` exercises export fidelity, two-organization projection, corrupt cross-lab reference rejection, tampering, create-only behavior and the schema's declared unique/composite constraints. `npm run check:client` validates the existing UI TypeScript. These tests cannot establish compatibility with a real PostgreSQL server; that requires a future PostgreSQL integration job using a disposable isolated database, not paid infrastructure.
