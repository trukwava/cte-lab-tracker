# Deployment gates — Riverton CTE Lab Tracker

**Status:** Not eligible for a public deployment. The repository is public, the **application is not hosted**.
This document names technical exit criteria rather than claiming approval, compliance, or readiness.

## Gate 1: Identity and permissions (blocking)

- For public use, replace selectable demo roles with reviewed identity from a supported provider, with server-validated sessions and explicit role assignment. A **local-only experimental pilot account mode** now verifies password credentials and persists hashed sessions, but it is not a hosting solution.
- Separate demo mode from real organizations and prevent fixture reset in production.
- Complete dynamic organization/lab scoping for every query and mutation based on the authenticated principal, not a hardcoded lab. New local cross-lab database triggers, response filters, and negative tests provide **defense in depth for the single Riverton lab**, but they do not enable multi-tenant service. Add fully separate organization principals and cross-tenant tests before hosting.
- Protect sign-in, reset, import and state-changing requests from CSRF, session fixation and abuse. Adopt secure cookies, HTTPS-only settings and rate limits for the hosted environment.

See [local pilot authentication](LOCAL_PILOT_AUTH.md) for the intentionally incomplete identity milestone.

## Gate 2: Storage and operations (blocking)

- Select and migrate to a hosted database with transactional single-active-loan enforcement; retain immutable audit and maintenance-policy history.
- Expand the new **local SQLite backup/verify/create-only restore procedure** into a reviewed hosted migration, managed backups, encryption, retention policy, routine restore drills, and recovery-time targets. Record monitoring, alerts and incident ownership. See [local recovery](RECOVERY.md).
- Configure secrets outside source control, trusted origins/hosts, TLS termination, trusted proxy boundaries and safe deployment environments.
- Keep public fixture demonstrations isolated from any real school data, with explicit non-production notices.

## Gate 3: Product and validation (blocking for pilot)

- Run end-to-end browser tests for issue, return, quarantines, maintenance, import correction, exports, and authenticated QR scans at phone/tablet resolutions.
- Audit keyboard/focus navigation, screen reader labels, color contrast and printable label layout. Confirm error states and user recovery.
- Perform a security review including authorization bypass, direct-object access, cross-site requests, upload/import manipulation, CSV formula injection, concurrent checkouts and log hygiene.
- Confirm procurement remains draft-only and service events are never presented as safety certification.
- Validate the pilot with a real authorized partner before any use of authentic student, staff or institutional records.

## Current safe workflow

Run the synthetic demo only on the same machine at `http://127.0.0.1:4173`.
`HOST` values other than `127.0.0.1` and `localhost` cause startup to fail.
The Host/Origin/CSP checks protect against accidental or browser-mediated exposure but do **not** make selectable demo roles secure.
Do not use a public tunnel, reverse proxy or network exposure to bypass this guard.

## Pilot decision

Once Gates 1–3 are evidenced, run a two-week shadow-mode lab trial measuring checkout speed, overdue resolution, missing-tool reconciliation, maintenance follow-through and staff entry burden. Stop for any unauthorized role access, blocked tool issued, duplicate active loan, untraceable release, or broken audit/recovery path.

### Organization membership boundary (partial)
Organization-scoped account membership checks and immutable default lab ownership are implemented, but application operations remain Riverton-only. Comprehensive per-request multi-org scoping, public TLS, production identity, and PostgreSQL are **not delivered**. See [ORGANIZATION_BOUNDARY.md](ORGANIZATION_BOUNDARY.md).
