# Data Migration & Cutover

## Access

A production copy is restored locally as Postgres database `csstorage`, with a dump at `.data/csstorage-2026-10-14.dump`.

We need a read-only copy of the production Postgres. On Heroku that's `heroku pg:backups:capture` + download,
done by the client or the current vendor. **Prerequisite: client authorization in writing**. The data is
customer PII plus payment references. Restore the copy locally or to a locked-down staging database. Never commit
dumps; never use real data in seeds or tests.

Scope: everything in legacy (2022 onward). Older seasons aren't imported. Nothing is ever purged from the new system (`open-questions.md` #26).

## Approach

`tools/legacy-import` is an idempotent, re-runnable TypeScript ETL. It reads the legacy schema directly and
upserts into the new schema keyed on `legacyId`. Because it can be re-run, it's rehearsed against fresh backups many times before the real cutover. It is never a live sync: the two systems never share ownership of data (`roadmap.md`).

| Legacy | New | Notes |
|---|---|---|
| `accounts`, `users`, `student_informations`, `parent_informations` | `Person`, `ContactPoint`, `PersonLink`, `BookingParty` | Person-centric merge per ADR-0004: exact normalized-email merges, phone-only matches go to a review queue. `accounts.profile_id` (CIM customer profile) moves to the payer Person's payment methods. `accounts.notes` → Note on the student |
| (consent) | `ContactPoint` consent fields | **SMS and marketing consent are unknown for legacy contacts**, so mark them `legacy_implied` and re-confirm at next signup |
| `contracts.year` | `Season` | One summer season per distinct year |
| `contracts` | `Booking` | `state != complete` → `draft`. `admin_state` mapping below |
| `schools`, `dorms`, `dorm_options` | `School`, `Residence` | `dorms.requires_address` → `kind: off_campus` |
| `services`, `service_fields`, `field_answers`, `contracts_services`, `schools_services` | `Service`, `ServiceField`, `FieldAnswer`, `BookingService`, `SchoolService` | Legacy hard-coded student/parent/school columns become reference-field answers on the migrated services. Legacy "services" that are really charge categories (Deposit, Moving Fee, Supplies, Repacking fee) become rate card categories, not services. A real service referenced by invoice lines but absent from `contracts_services` becomes a `BookingService { source: staff_addon }` |
| `calendar_events` (Pickup/Delivery/Move) | `Appointment` | Convert `at`/`end_at` to local date + window (AM/PM/ALL/CUSTOM). Skip `deleted` unless booking is active |
| `calendar_events` (School) | `ServiceDay` / blackouts | `dorm_pickup` / `off_campus_pickup` / `delivery` / `restrict_user_selection` → type + blocked scope |
| `calendar_events` (Note) | `CalendarNote` | |
| `events`, `deliveries` (older generations) | Import only for seasons predating `calendar_events`, or archive as JSON | Verify `Event.fix` +6h shift was applied before trusting timestamps |
| `invoices`, `invoice_items`, `invoice_transactions` | `Invoice`, `LineItem`, `Payment`, `Refund` | Decimal dollars → integer cents (round half-even, log any sub-cent values). Negative transactions → refunds. `status: void` → voided payment. Stored `credit_card_fee` → fee line item |
| `credit_cards` | `PaymentMethod` (`provider: authorizenet`) | CIM payment profile id + last four + expiry. No PAN exists to migrate. When the Stripe export mapping arrives, create `provider: stripe` rows and retire (don't delete) the CIM ones |
| `referrals`, `discount_codes` | `Referral`, `Promotion` | |
| `emails`, `email_tos`, `recipients` | `Campaign`, `Message` (historical, read-only) | |
| `crews`, `crew_members`, `employees` | `Crew`, `CrewMember`, `Employee` | Employee phone becomes the login |
| `notes`, `accounts.notes`, `contracts.notes` | `Note` | |
| `blacklisted_people` | `BlockedContact` | |
| `admins` | `StaffUser` | Force a password reset and 2FA enrollment. Do not migrate digests |
| blog, pages, testimonials, site_alerts, schedules, ckeditor_assets | — | Not migrated: customer-facing Rails pages are all replaced by WordPress (Josh, 2026-10-14). Kept only in the archive dump. Signup reference data (schools, school calendar events, school services, residences) **is** migrated |

### `admin_state` → new dimensions

| Legacy | lifecycle | flags | paymentStatus |
|---|---|---|---|
| incomplete | draft | | derived |
| new, deposit_paid, partial_payment, contract_paid, cc_declined, cc_declined_moving_fee | inferred from appointments: delivered if a past delivery exists, in_storage if a past pickup exists, else confirmed | | derived from the ledger. Report mismatches with legacy |
| finished | closed | | derived |
| cancelled / deleted | cancelled | `deleted` → also `archived` | derived |
| car_storage, short_term_storage, semester_storage, customer_abroad | inferred | `car_storage`, `short_term`, `abroad` | derived |
| damage_claim, lost_item, shipping_claim | inferred | `claim_open` + create `Claim` stub | derived |
| need_more_info | inferred | `needs_info` | derived |

## Known data issues (from `baseline-metrics.md`)

- The database copy starts 2022-03-31. Find out whether older seasons exist anywhere; if not, history starts there.
- 4,367 abandoned drafts: import those from the current season only, archive the rest.
- 21,146 accounts with no bookings: don't import. Their CIM customer profiles are empty and can be cleaned up in Authorize.net later.
- 161 stored-balance mismatches: legacy bookkeeping noise and not a cutover blocker. Import line items and transactions as they are. Historical balances are whatever the rows compute; only *open* bookings in the current season get reviewed with the owner.
- Duplicate confirmation numbers almost always pair a finished booking with an `incomplete` draft, or are legitimate second bookings (car, abroad, shipping) for the same student. Keep the number on the completed booking; drafts don't get numbers. Any remaining collision in history gets a suffix.
- Same-student, same-season multiple bookings are legitimate (summer + car/abroad/shipping) and import as separate bookings under one student Person.
- Zero-amount invoice lines (notes, item lists) import as Notes. Lines matching item patterns ("2 lg boxes x $59") also seed historical Items (`source: legacy_text`).
- On-campus pickups stored at local midnight with no window → `windowId: null` (date-only appointment).
- Garbage dates (year 9999, 1904) → quarantine table for review.
- Legacy invoice-line descriptions that list items (e.g. "2 lg boxes x $59") can seed historical `Item` records for returning customers. Make this a best-effort parser and flag the results as `source: legacy_text`.
- Schema drift: the import must target the **production** schema (migration `20260723160000`), not `legacy/db/schema.rb`.

## Verification (must pass before cutover)

- Row counts per entity, legacy vs. new, with explained differences.
- Per-booking balance in new ledger = legacy `contracts.balance` (± $0.01). Every mismatch listed and reviewed with the client.
- Per-season totals of payments match the Authorize.net settlement reports for a sample of months.
- 50 random bookings spot-checked side by side by CSS staff.
- Confirmation numbers preserved for historical seasons.
- Bookings with items still in storage at cutover (mostly abroad/semester) keep their legacy confirmation numbers, which are already on their boxes; new allocations skip those numbers until the items go out.

## Cutover

Cut over **between seasons**. The best window is after August deliveries and before signups open. Steps:

1. Rehearsals: weekly imports → staging from fresh backups. Staff do their real daily tasks in staging alongside legacy for 2+ weeks and report differences.
2. Freeze legacy (maintenance page at `account.csstorage.com`), run the final import, verify, and switch DNS.
3. Keep legacy read-only (Heroku app scaled down, DB retained) for one full season as a fallback and for reference.
4. Accounts: Twilio (with 10DLC registration) and email sending under CSS-owned accounts; copy the legacy S3 files from Josh's AWS account into the CSS account. Done before cutover day.
5. Payments (ADR-0002): new cards go to Stripe from day one. Existing cards keep charging through Authorize.net CIM until the Authorize.net → Stripe export is imported, then switch per payment method. Keep the Authorize.net account open, with no profiles deleted, for at least one full season so a switch back is possible.
