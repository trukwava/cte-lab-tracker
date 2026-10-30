# Lab isolation boundary — implementation note

This is an incremental defense for the **single fictional Riverton lab**, not a multi-tenant launch. The server’s authenticated identity currently belongs to `riverton` exclusively.

## Guarantees introduced

1. Dashboard overdue loans, full loan history and service history are restricted to assets in `riverton`. Existing asset-detail, vendor, borrower, location, request, audit and export queries already apply Riverton-only checks.
2. Database triggers reject an asset’s location in another lab; a loan between an asset and borrower in different labs; an asset/vendor association in different labs; a purchase draft that refers to another lab’s asset or vendor; or an import-row acceptance linked to an asset from another lab. This also protects against direct database writers that bypass API validators.
3. A synthetic reset refuses to proceed when any foreign lab is present, avoiding destructive `DELETE` operations on another lab’s data. Initial seeding checks the Riverton lab rather than counting arbitrary assets in the database.
4. Tests insert an entirely separate synthetic lab alongside Riverton, exercise read isolation on every affected endpoint and CSV, attempt cross-lab foreign-key references, and verify reset refusal.

## Missing requirements for actual organization support

- Real organization and lab identities, with membership/role assignments checked on every request and update; no user-supplied tenant switch.
- Tenant composite keys or row-level policies for every dependent table, including audit and reporting access; migration and integrity audit for existing data.
- Hosted PostgreSQL with transactionally enforced one-active-loan uniqueness, configured connection pooling, backups and restore testing.
- Tenant-filtered exports and file/photo attachments, authenticated QR scans, monitored abuse prevention, secure cookies behind HTTPS and separate production/demo environments.
- Dedicated adversarial two-organization test suite covering each operation, not only read-only screens.

**Do not expose the server to a public URL or populate it with real school records.** The localhost host restriction is intentional.
