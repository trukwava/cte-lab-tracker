# Riverton CTE Lab Tracker

**Demo v0.1 · 29 October 2026 · local-first working implementation**

A workshop instructor can track every serialized tool, issue and return equipment, block questionable items, record service and prepare purchase-request drafts—without converting a recorded observation into a claim that the tool is safe.

> This is a **fictional one-lab demonstration**, not a live school system. All staff, borrower identifiers, equipment, vendor references and transactions are synthetic. The three-click demo sign-in is intentionally *not* a production authentication mechanism. No orders are submitted and no safety certification is issued.

## Start the demo

Prerequisites: **Node.js 22.13+** (22.16 tested). **Python 3** with the `qrcode` library is required only for printable QR sheets; the rest of the application works without Python.

```bash
cd cte-lab-tracker
npm start
```

Open **http://127.0.0.1:4173**. Choose **Demo Instructor** for all workflows, **Demo Staff** for checkout/return/flag/import, or **Demo Viewer** for read-only exploration. The app creates `data/riverton-demo.sqlite` automatically on first start and loads the 60-asset fixture. It persists every mutation across page reloads and server restarts.

There is no `npm install` step needed for the supplied precompiled `web/client.js`: the runtime server uses Node built-ins. For editing the TypeScript client, install TypeScript 5.8+ or use `npm install --save-dev typescript@5.8.3`, then `npm run build:client`. For QR label rendering, install locally as appropriate:

```bash
python -m pip install -r requirements.txt
```

Change the local port with `PORT=4300 npm start`. **This build deliberately refuses non-loopback `HOST` bindings** (`0.0.0.0`, LAN IPs and public interfaces) because anyone able to reach the demo role selector could assume instructor privileges. It also validates request Host/Origin, requires JSON for POSTs and disallows cross-site browser mutations. QR codes generated locally are intended for the same local host; cross-device or public QR flows require replacing demo authentication and reworking network access. Do not expose this app through a tunnel, reverse proxy or public hostname.

## Optional local pilot sign-in (experimental)

The default role-picker is intentionally a synthetic demo, **not real authentication**. An opt-in `AUTH_MODE=pilot` path now accepts locally provisioned username/password accounts, persists hashed sessions in a separate SQLite file, and disables the demo role-picker and reset endpoints. It **still runs only on localhost**, using the same fictional lab fixtures. It is not a publicly hostable or multi-tenant system.

```bash
AUTH_MODE=pilot node --experimental-strip-types src/account-cli.ts create teacher instructor
AUTH_MODE=pilot npm start
```

The first command prints a generated one-time credential; treat it as a secret. Read [Local pilot authentication](docs/LOCAL_PILOT_AUTH.md) for rotation, revocation, tests, and deployment boundaries. In both modes, do **not** publish the app behind a tunnel or proxy or add real student/staff records.

## Operator workflow

1. **Today:** see overdue loans, due maintenance dates, missing and quarantined equipment. These are work queues, not inferred risk scores.
2. **Asset library:** search/filter, open asset drawer, review location, condition, vendor references, maintenance policy versions and past service. Add a serialized asset, or edit an available asset with a required attribution note.
3. **Issue:** choose an available asset, fictional borrower code, observed condition and exact due time. The server creates one active loan in an immediate SQLite transaction; a uniqueness index rejects any competing loan.
4. **Return:** record condition, location and note. Reporting damage automatically opens an inspection block; returning alone does **not** clear the defect.
5. **Flag/release:** staff can flag an available item as missing, quarantined, awaiting inspection or in service. Only the fictional instructor role can release a block, with a required note and recorded condition. This is an **operational decision, not a safety determination**.
6. **Maintenance:** record the actual service date, notes and optional service reference (including a photo reference), or issue a *new* maintenance-policy version. The date-based next review is calculated from that service date and active interval. No machine-usage data is manufactured.
7. **Requests:** save a replacement/purchasing draft with quantity, reason, curated vendor reference and optional supplied estimate. Export CSV. There is no vendor integration, authorization-to-spend, or order placement.
8. **Import:** paste/upload CSV, preview rejected rows, correct them and commit valid rows. Repeating the same batch/row does not duplicate accepted assets. Original parsed source fields and normalized accepted fields are stored separately.
9. **QR labels:** the library generates a print sheet of up to 24 labels at once (use the browser Print command). QR contains a non-sensitive asset URL; the asset API requires a session before disclosing borrower information. A print sheet does not include borrowers or service notes.
10. **Audit:** inspect actor-attributed changes. Instructors can use **Reset synthetic demo records** in the sidebar. Reset is refused if the same database contains another lab; the demo must never silently delete other organizations' records.

The **Refresh** button is available on each screen; the UI reports the last fetched snapshot time. When another staff member has already issued an item, a stale screen receives an HTTP 409 with the current conflict rather than succeeding.

## Verified local recovery

Create, verify, and restore a SQLite snapshot with `npm run db -- backup`, `npm run db -- verify`, and `npm run db -- restore`. The restore is **create-only** and revokes old local pilot sessions. Backups contain sensitive local account material and are not encrypted automatically; keep them out of version control. See [Recovery runbook](docs/RECOVERY.md).

## Tests and verification

```bash
npm test
npm run check:client    # requires TypeScript compiler
```

The initial eleven automated tests passed on 29 October 2026, covering: fixture dimensions; signed-out borrower privacy and QR HTML; two simultaneous checkout requests plus independent database-constraint verification; damaged return and instructor release; blocked states; maintenance schedule and policy-history preservation; corrected/idempotent import; draft procurement persistence/export; role authorization; vendor/metadata editing; and original/normalized import provenance.

The HTTP server was started and verified against live API requests. **Browser visual testing was attempted but blocked by the execution environment's browser administrator policy** (`ERR_BLOCKED_BY_ADMINISTRATOR` for localhost). Desktop/mobile screens are implemented and TypeScript-checked, but interactive rendering and print layout have not been independently browser-certified. See `docs/IMPLEMENTATION_STATUS.md`.

## Source layout

```
src/server.ts            HTTP routes, validators, transaction-level actions and access control
src/db.ts                SQLite migrations, constraints, synthetic reset and audit records
src/domain.ts            dates, domain constants, safe CSV reading/writing
src/make_qr.py           local QR SVG renderer for printable sheets
web/index.html           semantic single-page shell
web/client.ts            TypeScript UI source and action wiring
web/client.js            precompiled browser code (no runtime npm dependencies)
web/styles.css           responsive instructor-focused interface
tests/acceptance.test.mjs automated HTTP + SQLite acceptance tests
tests/pilot-auth.test.mjs local pilot identity/session checks
tests/lab-boundary.test.mjs cross-lab isolation and destructive-reset checks
tests/backup.test.mjs backup/verify/restore and session revocation
fixtures/                CSV input and correction examples
docs/                    product brief, pilot, status and test evidence
```

## Architecture and domain guarantees

- **Persistent boundary:** synchronous Node SQLite with `BEGIN IMMEDIATE`, WAL, foreign keys and a partial unique index on active loans. This prioritizes simplicity and a strong invariant in a single-lab local demo; review the database adapter and concurrency model before deploying as a multi-process network service.
- **Roles:** instructor, staff, viewer. Every read of lab records requires a session; server-side actions check role, not UI appearance. Session cookies are HttpOnly / SameSite=Strict. Role selection is fictional and does not verify real identities.
- **Asset status:** `available → on_loan → available` on normal returns. `on_loan → inspection_required` on damaged return. `available → missing / quarantined / inspection_required / in_service` on a flagged observation. A blocked state requires instructor release with a note to return to `available`. Service does not lift quarantine. Editing a condition to damaged blocks issue.
- **Policies:** date-only due dates use UTC `YYYY-MM-DD`; exact loan due times use ISO UTC instants, displayed using the browser's named local timezone. Every service event retains the maintenance-plan-version ID and a snapshot of its computed next due date.
- **Purchasing:** cents are stored as integers, and estimates stay null if not supplied. Vendor references have a catalog reference and last-checked date; these do not imply stock, pricing accuracy, approved procurement or purchasing authority.
- **Imports:** a 300-row / 200 KB request ceiling, RFC4180-compatible quoting, duplicate tag validation, shared-serial warning (not an automatic merge), source/normalized provenance, per-batch row idempotency.
- **Data separation:** a single explicitly marked demo lab (`riverton`). The local demo is explicitly restricted to the fictional `riverton` lab. Read routes and exports are lab-filtered; relational triggers reject cross-lab asset locations, borrower loans, vendor links, import rows, and purchase references. Demo reset refuses to run against a database containing another lab. This is defensive isolation groundwork, **not** support for creating/serving multiple organizations. Production requires tenant-scoped identity, stronger authorization, migrations/backups, rate limits, accessibility testing and security review. See `docs/DEPLOYMENT_GATES.md` for the explicit release checklist.

## Limits and retention

Operational metadata and audit records persist **indefinitely in the local SQLite file** until reset or manual deletion. The reset action clears *all* fictional Riverton transactions and re-seeds, including audit history, but refuses to run in a database that contains another lab; the demo does not offer retention controls or individual deletion. Delete `data/riverton-demo.sqlite` (and its SQLite `-wal`/`-shm` companions when the server is stopped) to start fresh. Back up that file separately if preserving demo edits. The zip does not include an existing mutable database; it seeds a fresh one.

Not implemented: real identity provider, tenant isolation, student personal-data processing, automatic safety judgments, service-photo binary storage (only textual photo/service references), equipment sensing, comprehensive bulk consumables, vendor purchasing integrations, purchasing approvals, background processing, production deployment, district-wide reporting, or compliance certification. Optional AI is omitted: all P0 deterministic workflows operate without a model provider.

## Reference and provenance

This is an **original implementation** for managing classroom workshop equipment, using synthetic data rather than customer records. It is not an extension of any existing customer platform and does not incorporate proprietary artifacts or interviews. No adoption, savings, procurement or safety claims are made.
