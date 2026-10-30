# Local pilot authentication (experimental)

**This is NOT public hosting, production authentication, or a multi-tenant release.** The HTTP listener still rejects LAN/Internet binding, and the SQLite records are entirely fictional. This increment replaces the *role selector* with verified, locally provisioned accounts only when `AUTH_MODE=pilot` is explicitly selected. Demo mode remains the default.

## Reproducible setup

Prerequisite: Node.js 22.13+ with built-in `node:sqlite`. The app has no required npm dependencies at runtime.

1. Provision a local instructor account from the repository directory:

   ```sh
   AUTH_MODE=pilot node --experimental-strip-types src/account-cli.ts create teacher instructor
   ```

   The command prints JSON containing a random one-time password. **Treat the terminal output as a secret** (no screenshots or shared logs); store the password in a password manager, then clear any copied plaintext. Do not place it in shell history, environment files, or the repository.

2. Launch the local pilot on the **same machine**:

   ```sh
   AUTH_MODE=pilot npm start
   ```

3. Browse to `http://127.0.0.1:4173`, enter the username/password, and check that the displayed role corresponds to the provisioned account. Demo role buttons are unavailable.

4. Optional: create a staff or viewer account with the same `create` command and a different username and role. There is **no public signup**.

To reset credentials or disable a user, while the server is running or stopped:

```sh
AUTH_MODE=pilot node --experimental-strip-types src/account-cli.ts rotate teacher instructor
AUTH_MODE=pilot node --experimental-strip-types src/account-cli.ts disable teacher
```

Rotating or disabling an account removes all its stored sessions immediately. The CLI displays a fresh secret on rotation. Accounts are assigned explicitly to fictional lab `riverton`; other labs and organizations are not supported.

## Security boundaries

- Passwords are verified server-side using a randomly salted `scrypt` hash; plaintext is never written to SQLite, responses or audit logs. Each account has an administrator-selected role. Unknown users receive the same error as incorrect passwords.
- Browser session tokens are unpredictable and are **only stored as SHA-256 digests** in SQLite. Tokens live in `HttpOnly; SameSite=Strict` cookies with an eight-hour maximum lifetime; logout revokes them, and sessions survive application restart.
- Local failed logins are throttled after five attempts in 60 seconds; this limiter is **in-process**, so it resets after restart. It is not suitable for distributed hosting.
- Demo endpoints for login and reset are disabled in pilot mode. Pilot mode uses the separate default database `data/riverton-pilot.sqlite`. Do **not** point two modes at the same `DB_FILE`; demo reset can destroy the synthetic fixtures. Backup the pilot database before experimenting with any migrations.
- Lab access is explicitly pinned to the *single fictional Riverton lab*. Existing domain queries still target that lab. **There is no multi-tenant authorization model**; the next significant increment must add organization and lab membership checks at every persisted-data boundary.
- The HTTP origin/host hardening is inherited from the demo branch. It deliberately refuses a network listener, public tunnel or reverse proxy. The local HTTP cookie is not marked `Secure` because TLS is absent. Public hosting must use an independently reviewed identity solution, secure transport, scoped session infrastructure, durable storage, rate limiting, backups and incident monitoring.
- Only generated fixture identities and data are appropriate. Do not store real names, student records, real asset serials or actual vendors in this experiment.

## Verification

`npm test` covers all original 16 domain/HTTP cases plus pilot authorization, logout, persistence after restart, rotation, disabling, and local throttle cases. `npm run check:client` checks the TypeScript frontend. These are necessary but not sufficient for deployment or school use; an accessibility audit and full browser test remain outstanding.

## Remaining gates

See `docs/DEPLOYMENT_GATES.md`. The primary blockers are multi-organization/tenant isolation, reviewed identity/session provider, HTTPS hosting with trusted proxy rules, hosted transactional database and backups, and actual user research with an authorized partner. Do not infer approvals, savings, equipment safety or purchasing authority from this demonstration.
