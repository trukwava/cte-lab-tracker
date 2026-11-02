# Authenticated laboratory scoping — November 2, 2026

**Status: locally verified implementation, not a production tenancy certification.** The application still binds only to `127.0.0.1` or `localhost`; no public hosting or institution data is authorized by this milestone.

## Implemented

- In `AUTH_MODE=pilot`, credentials and persistent sessions derive the home `lab_id` and `organization_id` from stored account ownership, registered organization/lab mappings, and **both currently enabled memberships**. The effective role is the more restrictive of organization and lab roles. A role change or revocation applies to an existing cookie on its next request.
- Every operational HTTP request derives its laboratory from that authenticated session. Neither a query parameter nor a request body may select or override the lab. The selectable demonstration identity remains pinned to the original fictional `riverton` lab.
- Asset lists and details; loan, service, vendor, borrower, location and purchase lists; dashboard and audit queues; QR label requests; CSV exports; import batches; and asset and purchase mutations use the session's lab ID. Foreign assets return `404`; foreign vendors and locations are not valid references.
- Database audit writes now take an explicit laboratory ID. Direct SQLite triggers also prohibit cross-lab loan return locations, condition events associated with another asset's loan, and approval/asset mismatches. Earlier single-active-loan uniqueness and cross-lab borrower/vendor/purchasing constraints remain in place.
- A two-organization HTTP test uses independent stored accounts with separate home labs and verifies read/write/export/import isolation, checkout/return/audit attribution, blocked damaged returns, and live membership revocation. Direct database tests cover the added constraints.

## Deliberate limitations

- This **does not** provide self-service organization creation, invitations, switching between multiple memberships, a production admin UI, or remotely managed accounts. Existing CLI provisioning continues to create accounts only for fictional Riverton. Tests manually provision a second fictional lab/account to exercise the scope boundary.
- Global asset tags, borrower codes and location identifiers still have global uniqueness constraints, so this is not a complete independent per-tenant namespace design.
- No PostgreSQL adapter, row-level-security policy, shared database connection pool, public TLS session cookie, hosted identity provider, external file storage, distributed rate limit, or production recovery process has been added.
- No production records, paid services, or public service are connected. Browser-level visual/accessibility testing is still outstanding.

## Verification

Run `npm test` and `npm run check:client` with Node 22.16+ and TypeScript 5.8+. The new tests are `tests/tenant-scoped-http.test.mjs` and `tests/tenant-db-invariants.test.mjs`; retained `tests/membership.test.mjs` keeps the prior membership coverage in the local test archive. Local verification on this branch: **34 tests passed, zero failed**, TypeScript check passed.

**Do not deploy publicly.** Next gates include a complete tenant-key audit for each relational table, isolation under a hosted database, real account lifecycle and identity provider, HTTPS and cookie review, tenant-aware backup/restore, and an external security/browser assessment.
