# Organization membership authorization (incremental local-only milestone)

## What is implemented

- An additive schema for `organizations`, `organization_labs`, and `organization_memberships`. Every existing or newly inserted lab gets a **separate** default organization (`org-<lab_id>`), never a shared tenant inferred from a name. Lab-to-organization assignments cannot be reassigned by ordinary SQL updates.
- Existing local accounts retain their Riverton home lab. Existing enabled lab memberships are backfilled into their default organization; disabled accounts or revoked lab memberships are not re-enabled. Running the migration repeatedly does not resurrect a revoked organization membership.
- Pilot sign-in and **every existing session lookup** require both an enabled lab membership and an enabled membership in that lab's organization. An organization's `viewer` or `staff` role caps a more permissive lab role. Revoking an organization membership or lowering its role takes effect immediately for existing sessions.
- Account disable revokes both memberships. Explicit account rotation/provisioning re-enables both and invalidates prior sessions. Account home-lab and organization ownership are immutable through ordinary updates.
- Tests cover two separate fictional organizations, contradictory role levels, live session revocation, legacy upgrade, and direct SQL attempts to remap the account into another lab.

## Deliberate boundaries

**This does not authorize multiple laboratories in the HTTP application.** The existing server still hardcodes the fictional `riverton` lab for all operational queries and refuses non-loopback binds. A user cannot select arbitrary organization or lab identifiers through request input. This schema is a staged security boundary, not a hosted multi-tenant launch.

Future work must introduce independently audited per-request organization and lab scoping to *every* asset, loan, maintenance, audit, import, and export operation; organization-lab administration with audit logs; PostgreSQL transactions and production authentication. Backups of pilot databases contain credentials and operational data, so do not commit them. Public deployment remains blocked.

## Verify

Run `npm test` and `npm run check:client` on Node.js 22.16+. See `tests/organization-boundary.test.mjs` for the four DB-level scenarios and `tests/organization-http.test.mjs` for a live HTTP role downgrade/revocation scenario.
