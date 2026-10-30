# Lab membership authorization — foundation

The local pilot now persists explicit `(account_id, lab_id)` memberships. New logins and existing sessions use the **enabled membership** rather than the legacy account role column. Revoking a membership immediately blocks associated sessions; editing its role immediately changes session authorization. Provisioning synchronizes membership and revokes earlier sessions, while disabling an account disables membership.

Migration is additive: existing accounts receive a membership in their current lab on first open, and repeat migrations do not overwrite revocation.

## Limitations

This is **not** a multi-tenant server. Only the fictional Riverton lab receives user identities, and the server remains localhost-only. Memberships are administered through the existing local account CLI. Current asset, audit and export code is single-lab scoped, so the presence of membership rows does not authorize use with additional organizations or live school records. Hosted PostgreSQL, production identity, TLS, and comprehensive cross-tenant adversarial tests remain outstanding.

## Verification

Run `npm test` and `npm run check:client`. Two regression tests in `tests/membership.test.mjs` cover legacy migration, role changes, revocation and credential rotation. This is not a comprehensive security audit.
