# Implementation and verification status — 2026-10-30

**Implemented and API-tested:** SQLite persistent data model, versioned maintenance, audit events, status transition validation, one-active-loan database constraint, checkout/return, damaged-item inspection block, instructor release, service record, due queue, draft purchase request, CSV export, import preview/correction/idempotency and source provenance, session-guarded asset API and printable QR label HTML, deterministic fixtures, demo reset and basic instructor/staff/viewer authorization.

**UI implemented and TypeScript checked, but not browser-verified:** Today, Asset Library, Loans, Maintenance, Purchase Drafts, Import, Activity Log; add/edit asset; issue/return/flag/release/service/policy modal actions; search and status filters; QR printing; desktop/tablet/mobile responsive CSS; synthetic demo sign-in; explicit last-updated/refresh and error messages.

**Automated verification:** `npm test` — 16 passed, 0 failed (Node HTTP API + isolated SQLite, including two concurrent requests and direct SQLite uniqueness rejection). `npm run check:client` — passed.

**Attempted UI verification limitation:** A Chromium/Playwright navigation to the local preview was blocked with `net::ERR_BLOCKED_BY_ADMINISTRATOR`. No screenshot, real mobile visual review, keyboard end-to-end audit or printer layout certification is claimed. UI behavior must be checked by the recipient in a locally permitted browser.

**Local demo hardening (2026-10-30):** Refuse all non-loopback bind addresses before opening SQLite; require loopback Host and matching Origin; reject cross-site browser requests; enforce JSON content type and 300 KB request-body limit; set CSP/clickjacking/referrer/cache headers; remove inline browser handlers; prevent invented import row numbers; strictly validate calendar maintenance dates. These are protective boundaries for a demo, **not authentication or production security certification**.

**Partial:** Service event accepts a photo/document **reference string**, not a stored binary attachment. Single curated asset vendor reference is editable, supported by a mapping table; a complete vendor approval workflow is not included. Client shows last-loaded snapshot with manual refresh, not a real-time multiuser live feed. UI accessibility is basic but not audited with assistive technology.

**Not implemented / deliberately deferred:** production auth, multi-organization isolation, student data, actual vendor integrations, external approvals, automated safety checks, bulk consumables, paid AI calls, offline synchronization, advanced storage retention controls, production deployment and certification.

**Run evidence:** A local server successfully responded to `/api/session`, rejected `/api/assets/AST-001` with HTTP 401 while signed out, accepted an instructor demo session, reported the seeded fixture counts and generated printable QR HTML. These checks establish API behavior only, not visual workflow certification.

**Next release gate:** Do not add a public URL while self-selected roles remain in place. The hosted pilot requires real identity, scoped authorization, a hosted persistent database, backup/recovery, abuse protection, and an end-to-end browser/security review (`docs/DEPLOYMENT_GATES.md`).


## 30 October 2026 — local pilot authentication experiment

- Added separately configured `AUTH_MODE=pilot` and a CLI that issues random local credentials for instructor/staff/viewer roles.
- Added scrypt password hashes, hashed persistent session tokens, account disabling/rotation, strict cookie flags, and local failed-login throttle.
- Disabled demo role selection and fixture reset in pilot mode; kept loopback-only deployment guard and a separate synthetic database.
- Explicitly **not** shipped: public hosting, TLS, organization-scoped authorization, real institutional data, managed identity, durable cloud storage, or a production security review.
- Added automated pilot authentication/revocation/restart tests. Live CI status to be confirmed on GitHub, not inferred from local runs.


## 30 October 2026 — single-lab isolation hardening

- Added lab predicates to loan and service-history list endpoints and the Today overdue queue; foreign-lab records cannot bleed into the Riverton dashboards, exports or asset detail pages.
- Added persistent SQLite triggers for cross-lab asset location updates, borrower loans, vendor associations, purchase references and import accepted rows, including direct database writes outside the HTTP layer.
- Demo reset and seed now fail closed if any other lab exists in the same database; changes in a foreign lab cannot be erased by a synthetic reset.
- Added a second fictional lab only inside an isolated adversarial test database, with extra records and attempted cross-lab references.
- Local regression result: `npm test` **24 passed, 0 failed**; `npm run check:client` unchanged. GitHub CI outcome must be checked separately.
- Limitation: this remains a **single-lab application** with a hardcoded `riverton` principal, not general multi-organization authorization. Hosted DB/TLS/identity/backups remain blocked.


## 30 October 2026 — local recovery tools

- Added a Node built-in online SQLite snapshot CLI; verifies backup integrity and a SHA-256 digest without copying a live database file around its WAL journal.
- Added create-only restore to a new database location, with saved login sessions revoked and historical audit records preserved.
- Added a recovery runbook and automated restoration test (including backup while a separate writer connection remains open).
- Local regression result: **25/25 tests passing** with TypeScript client check passing. GitHub CI to be confirmed on the pull request.
- Not implemented: scheduled/offsite backups, cryptographic encryption at rest, PostgreSQL recovery, recovery-time targets, or restoration to active production systems.

## Organization boundary checkpoint (2026-10-31)
Added default one-lab-per-organization mapping, organization memberships, dual membership authorization for pilot sessions, effective role ceilings, and adversarial migration/revocation tests. This is local-only, not production multi-tenancy.

The subsequent HTTP authorization test confirms that role downgrades return 403 on instructor-only mutations and revoked organization membership returns 401; 32 local tests pass.
