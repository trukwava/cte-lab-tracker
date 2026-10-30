# Product brief and state model — 2026-10-29

**User:** fictional carpentry workshop instructor, coordinating with lab staff.

**Promise:** Know which tool exists, where it is, who holds it, what condition was observed, what review is due, and what needs replacement—without leaving an unreviewed action or unsafe assumption implicit.

**Smallest complete vertical slice:** An available drill is selected → server validates borrower, due instant, status and role → SQLite transaction inserts a unique active loan → status changes to `on_loan`, location becomes unknown while issued, audit and condition records are written → Today/Loans show the loan → staff records a condition and destination on return → state persists and appears in exports/review screens. Concurrent checkout is rejected and a damaged return creates an inspection block.

**P0:** Individual serialized asset create/edit; assets with vendor references and location/status/condition; persistent checkout and return; quarantines and instructor release; Today attention queues; versioned date-based service records; draft purchase requests and CSV export; import validation/correction; QR print sheets with session boundary; audit history; 60-asset synthetic fixtures and local reset.

**Risk and mitigation:** Real school authentication and reliable inventory source are the riskiest dependencies. Demo mode replaces them with *explicitly simulated* role sessions, fictional borrower IDs, a curated synthetic vendor list and deterministic seed data. No connection is misrepresented as genuine.

## Entities

`Lab`, `Location`, `Asset`, `AssetTag`, `BorrowerReference`, `Loan`, `ConditionEvent`, `MaintenancePlanVersion`, `ServiceEvent`, `Quarantine`, `VendorReference`, `AssetVendorReference`, `PurchaseRequest`, `Approval`, `AuditEvent`; plus `ImportBatch`/`ImportRow` for provenance and idempotency.

### State transitions

| Event | Preconditions | Persistent effects |
|---|---|---|
| Checkout | Role instructor/staff, asset available, known borrower, future exact due time | Single active loan, status on_loan, audit and checkout condition |
| Normal return | One active loan, known destination | Loan closed, location and condition recorded, status available |
| Damaged return | One active loan and `damaged` observation | Loan closed, condition event, status inspection_required, open quarantine |
| Flag | Available asset, recorded explanation | Missing/quarantined/inspection_required/in_service, audit and quarantine when relevant |
| Instructor release | Blocked asset, instructor role, explanation, confirmed location if missing, non-damaged observation | Close quarantine, status available, approval/condition/audit records; **not** certification |
| Service | Asset not on loan, instructor note, actual service date | Immutable service event with policy version and next due snapshot; no status clearance |
| Interval change | Instructor, integer days 1–3650 | New version, policy schedule recomputed, older events unchanged |
| Purchase draft | Instructor, item/quantity/reason | Draft row and audit record only; no vendor action |

**Maintenance rule:** `next_due_date = calendar_date(service_date or version base) + interval_days`. Date comparisons use UTC date-only values; a date is due if `next_due_date <= current UTC date`. No usage-based calendar inference.

**Hard invariant:** SQLite index `only_one_active_loan_per_asset` on `loans(asset_id) WHERE returned_at IS NULL`, reinforced by immediate transactions and status validation.

**Parking lot:** Bulk consumables, physical usage counters, image-based judgment, binary service-photo storage, automated repairs, real staff/student identity, external vendor purchasing, purchase approvals, multi-lab district rollouts and AI suggestions. None is presented as part of P0.
