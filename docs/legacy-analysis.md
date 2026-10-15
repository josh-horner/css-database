# Legacy System Analysis

Snapshot of `legacy/` as of 2026-10-14. Purpose: capture what the business depends on so nothing is
lost in the rebuild, and document the defects that justify it.

## Facts

| | |
|---|---|
| Stack | Rails 6.0.5 (EOL), Ruby 3.2.9, Postgres, Delayed Job, Webpacker 5 (dead), Vue 2 (EOL), AngularJS via Bower (EOL), CoffeeScript, Sprockets, Paperclip + CarrierWave (two upload libs), CKEditor 4 |
| Hosting | Heroku (`web`, `worker`, `release: db:migrate`); S3 for uploads |
| Integrations | Authorize.net CIM via ActiveMerchant; Twilio SMS; SMTP email; Honeybadger; reCAPTCHA |
| History | 1,065 commits, Oct 2016 → Oct 2026. Third-party maintainer active through Apr 2026 (GitLab `bkmediagroup-josh/css`, staging → master flow) |
| Size | ~45 tables; `Contract` model is 977 lines; ~2,200 lines of admin controllers; ~1,300 lines of tests (mostly scaffolding) |
| Public site | www.csstorage.com is WordPress. The Rails app's own CMS (pages, blog, testimonials, school pages, site alerts) is unused; WordPress replaced all customer-facing pages (Josh, 2026-10-14). Admin-entered signup data (schools, school events, school services, dorms) is still live and drives signup |

> `legacy/` was pulled from production (latest commit 2026-08-11) and matches the production schema. The
> vendor keeps their own repo. Measured usage, pricing, and data-quality numbers are in `baseline-metrics.md`.
> Since April 2026, per-service flags drive which appointments a signup collects, delivery days are split by
> on/off campus, and login links are single-use with resend throttling.

## What the system does

### Customer side (`account.csstorage.com`)
1. **Passwordless login**: email → magic link + 4-digit PIN cookie (`SessionsController`, `User#create_auth_token!`). Link valid 24h. *Worth keeping in spirit.*
2. **Signup** (single long form, `SignupsController#info` → `#update`):
   school → dorm (or off-campus) → Greek house option → student info → parent info →
   services (+ per-service custom fields) → pickup date/window/address → signup source ("how did you hear") →
   parent/student referral emails (+ Venmo handle) → discount code → card → terms.
   Can "save for later".
3. On submit: tokenizes card to Authorize.net CIM (raw PAN passes through our server), charges a
   **deposit** (`ENV DEPOSIT_AMOUNT`, $59 in production since 2023; line item hard-coded to `service_id: 59`), adds special-pickup fee
   if chosen, applies referral credits, sends confirmation emails, emails each referred address,
   sends per-service info emails.
4. **Account page**: view contracts, edit student/parent/billing info, set pickup and delivery
   appointments, print labels, add referrals.

### Back office (`/admin`)
- **Contracts**: list with filters (status, year, school, dorm, balance, on/off campus), text search
  over a denormalized `search_cache`, incomplete signups, archive, duplicates, print sheet, cover sheet, labels.
- **Admin status** (manually set): deposit_paid, contract_paid, partial_payment, cc_declined,
  cc_declined_moving_fee, cancelled, finished, deleted, damage_claim, lost_item, short_term_storage,
  car_storage, semester_storage, customer_abroad, shipping_claim, need_more_info, new.
- **Invoices**: staff manually add line items (storage charges, fees), then "charge" against the card on file.
  3% card fee added unless waived. Void/refund via CIM. Invoice states: open → paid / failed_billing.
- **Transactions** search (by txn id, auth code, day, last four, amount).
- **Calendar** (FullCalendar/Vue): pickups, deliveries, moves, notes, school events, scheduled emails.
- **Crews**: name a crew for a day, attach employees and calendar events; "notify" texts employees a
  secret link to their schedule (`/schedule/:id/:secret` — no login).
- **Messages**: email or SMS to segments (school, dorm, year, status, balance, on/off campus,
  students/parents/both, referral recipients); can be scheduled.
- **Config**: schools (colors, logos, special fees, delivery slots), dorms + options, services + custom
  fields, discount codes, signup sources, blacklist (email/phone), admins.

### Scheduled jobs (Heroku Scheduler → rake)
- `events:notify_in_two_days`, `events:notify_tomorrow`, `events:notify_today` — SMS both parent and student.
- `events:send_messages` — deliver scheduled campaigns.

## Where the business rules live

| Rule | Location |
|---|---|
| Signup completion validations (different parent/student email+phone, one active booking per student email per year, blacklist, terms, venmo required if student referrals) | `contract.rb` state `:complete` block, ~L195–415 |
| Confirmation number = lowest unused ≥100 among non-cancelled contracts in the year. Reuse is deliberate: the number labels items in the warehouse | `contract.rb#assign_confirmation_number` |
| Referral rewards: parent referral → both get $25 credit; student referral → referee $10 off, referrer gets a $0 line item reminding staff to **Venmo $25 manually**; fallback "fb" referral via secret cookie | `contract.rb#handle_referrals`, `#handle_fb_referral` |
| Deposit, last-minute fee (disabled), special pickup fee | `invoice.rb#create_deposit`, `signups_controller.rb#update`, `school.special_pickup_fee` |
| Card fee 3% unless waived or subtotal ≤ 0 | `invoice.rb#credit_card_fee_rate` |
| Available pickup dates per school (on- vs off-campus), minus blackout events, ≥2 days out | `school.rb#pickup_dates`, `#off_campus_pickup_dates`, `dorm.rb#pickup_dates` |
| Delivery dates, "special delivery" paid option, 2-day minimum lead time | `school.rb#delivery_dates`, `calendar/delivery.rb` |
| Windows: AM 9:30–12:30, PM 1:30–4:30, All Day 9:30–4:30, Other (admin only) | `calendar/pickup.rb`, `calendar/delivery.rb` |
| Moving a pickup to another day unassigns its crew | `calendar/event.rb` before_save |
| Cancelling/deleting a contract soft-deletes its appointments; restoring restores them | `contract.rb` admin_state after_transition |
| SMS reminder copy | `calendar/*.rb` `*_message` methods |
| Off-campus-only services; on-campus dorms get a subset | `dorm.rb#services`, `service.off_campus_only` |

## Defects and debt (why rebuild rather than upgrade)

**Platform**
- Every major dependency is end-of-life (Rails 6.0, Vue 2, AngularJS, Webpacker, Bower, CKEditor 4, Paperclip). An upgrade path touches nearly every file anyway.
- No meaningful test coverage around money or scheduling.

**Data model**
- Three generations of scheduling tables coexist: `events` (old), `deliveries` (named `crap_delivery` in code), `calendar_events` (STI). Plus a one-off `Event.fix` that shifted timestamps +6h to repair a timezone bug.
- Time windows stored as seconds-since-midnight magic numbers (34200, 48600, legacy 46800).
- `admin_state` conflates lifecycle, payment status, and product type in one manually set field — staff must remember to change it, and reports can't trust it.
- Contact data in three places (`users`, `student_informations`, `parent_informations`) with a hand-built `search_cache` and `LIKE` search.
- `year` integers instead of seasons; abroad/semester storage doesn't fit.
- Money as `decimal` with `to_f` arithmetic in Ruby (`invoice.rb#update_totals`) — float rounding on totals.
- Stored `balance` columns on contract and invoice that can drift from transactions.

**Operations**
- **Every login creates an Authorize.net CIM customer profile** (`User#create_account` → `Account#send_to_authnet`): 21K of 29K accounts have no booking.
- **The crew/employee feature has been unused since July 2024.**
- **No item inventory.** Nothing records what was picked up, its condition, or where it sits in the warehouse (just a free-text `warehouse_location`). Damage/lost-item claims have no evidence trail.
- Storage pricing ("pay only for what you store") is computed by hand: crews fill out a written sheet at pickup, and the owner types it into invoice lines.
- Crew capacity check (`SLOT_MAX = 10`) is commented out; the only capacity control is admins manually blacking out full days.
- No routing — crews get an unordered list.
- Referral payouts are manual Venmo reminders.
- Declined cards become a status someone notices; no automated retry/dunning.

**Security / compliance**
- Raw card numbers transit the Rails server to build CIM profiles → PCI SAQ D scope.
- Live credentials in `legacy/.env`; a hard-coded export secret in `lib/tasks/contracts.rake`.
- Employee schedules are public secret URLs; one admin role with full access; no audit log.
- SMS is sent to parent and student phones with no consent record or STOP handling (TCPA / 10DLC exposure).
- Confirmation-number assignment is a read-then-write race (recent commits patch duplicates).
