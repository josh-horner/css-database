# Domain Model

Draft. Names are the TypeScript/Drizzle names; tables are snake_case plurals. All tables have
`id` (uuid v7), `createdAt`, `updatedAt`; migrated rows add `legacyId`.

## Map

```
Season ─┬─ RateCard ── RateCardItem (category × sizeClass → price)
        └─ ServiceDay (school × date × appointmentType × window → capacity)

Service (offeredFrom/Until, successor) ── ServiceField (owner-configured, typed) ── FieldAnswer
   └── SchoolService ── School ── Residence (dorm | greek house | off-campus)   ← only for student services

Person ── ContactPoint (email/phone, verified?, consent)        ← login = verifying a ContactPoint
   ├── PersonLink (guardian_of → student Person)
   └── PaymentMethod (provider + token; owned by the payer)

Booking (customer Person × season × service set) ┬─ BookingParty (personId, role)  → derives access
                                                 ├─ BookingService ── FieldAnswer
                                                 ├─ Appointment (pickup | delivery | move | supply_drop | ship)
                                                 │     └─ Job ── RouteStop ── Route ── Crew ── Employee
                                                 ├─ CaptureSession ── ItemPhoto ── AiSuggestion
                                                 ├─ Item (rate card item or "other" × quantity, photos)
                                                 ├─ StorageLocation (where this booking's things are)
                                                 ├─ Ledger: Invoice ── LineItem; Payment; Refund; CustomerCredit; WriteOff
                                                 ├─ Claim
                                                 └─ Note
SignupDraft = Booking in lifecycle `draft` + FunnelEvent log

Referral, Promotion, Template/Campaign/Message/InboundMessage, MarketingSync (Mailchimp),
AuditEvent, StaffUser
```

## Identity and access (ADR-0004)

The core problem: we collect a student and a parent on every signup and know who filled out the form, but
not who will need access later. Legacy partly solves this. `User#contract_ids` grants access when your
login email matches the student or parent info on a contract. We make that the model, not a workaround.

### Person, ContactPoint, PersonLink
- **Person** is a human: a student, parent, or guardian. A Person persists across seasons, and the student Person is the anchor of continuity ("Jamie's stuff, every year").
- **ContactPoint** is an email or phone owned by a Person, with `verifiedAt`, `smsConsentAt`, `smsOptOutAt`, `marketingConsentAt`, `bouncedAt`. One Person can have several.
- **PersonLink** `{ guardianId, studentId }` records the parent/guardian relationship. A parent with two kids is one Person with two links (216 legacy accounts have siblings).

### BookingParty and derived access
`BookingParty { bookingId, personId, roles: customer | student | guardian | payer | signer }`. Every booking has
exactly one `customer` (the person the service is for) and exactly one `payer`. When a booked service
collects student info, the customer is also the `student` and at least one `guardian` contact is required
(unless a staff waiver). An IKEA delivery has just a customer, usually also the payer.

**Signing in means verifying a ContactPoint** (email magic link or code, SMS code). A session resolves to the
Person(s) that own that ContactPoint. You can see every booking where one of your Persons is a party,
with permissions by role:

| Role | Can |
|---|---|
| customer / student | view booking, items/photos, appointments; reschedule; request deliveries |
| guardian | everything a student can, plus edit contacts |
| payer | billing, payment methods, pay balance (often also guardian) |
| signer | whoever submitted it (informational) |

Consequences:
- Nobody has to decide up front who gets an account. The student and parent named on the form can both log in later just by proving they own their email or phone.
- **Adding access later**: any guardian or payer (or staff) can invite another email or phone, such as a second parent, by attaching it as a ContactPoint on a new Person with a `guardian` party role. A recovery path exists for "I changed my email": staff verify the person and add the ContactPoint.
- A shared family email (179 legacy bookings have student email = parent email) resolves to both Persons. The UI shows both roles, which is fine.
- **No data is revealed before verification.** Typing an email on the signup page never shows "Welcome back Jamie" until the code or link is verified.

### Returning customer re-signup
1. Entry points: the "Sign up again for 2028" button on any past booking, a link in the re-signup email campaign (one-time login link), or an email on the signup page that, after verification, matches a known Person.
2. "Who is this for?" lists the student Persons this login can act for (self, or their children), plus "someone new".
3. A new draft is cloned from the student's most recent booking: same parties, same payer and saved card, same school. **It asks only what changes each year**: residence, pickup date and window, services, and a quick "still correct?" on contact info.
4. Pay deposit with the saved card in one tap. Target: **under 60 seconds**.

### Contact snapshots
The booking stores a JSON snapshot of each party's name and contacts at confirmation, used for print and audit.
Current values live on Person and ContactPoint, so edits made later don't rewrite history.

## Season
`{ name: "Summer 2027", kind: summer | semester | year_round, signupOpensAt, pickupStart, pickupEnd, deliveryStart, deliveryEnd }`.
Replaces the bare `year` integer. The deposit amount moves from the `DEPOSIT_AMOUNT` env var (currently $59)
to the season's rate card.

**RateCard** per season: `RateCardItem { code, category, sizeClass?, unit: each | hour | minute | flat, priceCents, aiSelectable, examplePhotoIds[] }`.
**The owner maintains it in admin**; prices are his discretion and change over time, so nothing is hard-coded.
Seeded from prices mined from 2025–26 invoices (`baseline-metrics.md#prices-observed-in-invoices`, ~50 items:
fees, labor rates, boxes and bins by size, furniture, appliances, sports gear, supplies). Labor is per crew size per
hour, and stair/upstairs time is the same rate per minute.
- **Learning the price list from his decisions.** The AI identifies items (category, size); when it proposes a
  category with no rate card price, or the owner overrides a price in review, admin offers "add/update this in the
  rate card". Over a season the table converges on what he actually charges, with real photos attached as examples.

## Booking (was Contract)

One **customer Person** + one season + a service set. School and residence are present only when a booked
service collects them (student services do; an IKEA delivery or local move doesn't).

- **A student can have several bookings in one season** when they're different engagements, e.g. summer storage + car storage, or summer + abroad. Legacy data shows this is common and legitimate. Each has its own confirmation number, appointments, items, and invoices. The UI groups them under the student and season.
- **Add-on services** (Josh, 2026-10-14): the owner often adds services to an existing booking (moving labor, shipping,
  short-term storage, special pickup, handyman…) without the customer signing up again. That stays, but structured:
  - Admin **Add service** on a booking: pick the service, fill its fields in staff mode (non-required fields skippable),
    create any appointments, see the price estimate, and record a reason. It becomes a `BookingService { source: signup | staff_addon | customer_addon }`.
  - The customer is notified with what was added and the estimate. Optionally (owner setting per service or above an
    amount) they must accept through a link before work is scheduled, which records terms acceptance.
  - Customers can add services themselves from the portal the same way.
  - If it's really a separate engagement (e.g. car storage), staff create a new booking for the same student instead; admin suggests which.
- Duplicate guard: **warn** (staff may override) if the same student already has a non-cancelled booking in the season containing the same service.
- Abroad/semester storage can span seasons, usually into the next year and sometimes longer (Josh, 2026-10-14). The booking keeps its original season, and `storageUntil` drives billing and delivery. Its confirmation number stays reserved until delivery. Legacy tracks these with `admin_state = semester_storage` (24 in 2026, up from 1–7 in earlier years).

Three **independent** status dimensions:

| Dimension | Values | Set by |
|---|---|---|
| `lifecycle` | `draft → confirmed → picked_up → in_storage → delivery_scheduled → delivered → closed`; `cancelled` from any pre-delivery state | System transitions from events (signup submit, crew capture complete, delivery sign-off); staff override audited |
| `paymentStatus` | `none_due · deposit_paid · balance_due · paid · past_due · refunded · written_off` | **Derived** from the ledger, never hand-set |
| `flags` | `abroad`, `car_storage`, `short_term`, `claim_open`, `needs_info`, `vip` … | Staff and system |

`confirmationNumber`: **the one number** the owner, staff, crews, and customer all use. It's written on the customer's
labels and boxes and is how things are found in the warehouse, so it is not split into separate customer and warehouse
numbers (Josh, 2026-10-14: any lookup/translation step in the field risks handing items to the wrong customer).

- Assigned when the signup completes, as the **lowest free number ≥ 100** in the season (legacy behavior, kept on
  purpose: short numbers are easier to write and find, and cancelled numbers are reused).
- **Improvement over legacy:** a number is also treated as taken while any booking from an earlier season still has
  items in storage under it (abroad/semester), so a new booking can't collide with boxes already on the shelf.
  (Today the owner avoids this by setting abroad items aside; that keeps working.)
- **No prefixes.** Since 2022, 15–40% of bookings per season have needed 4 digits (max 1,502 in 2022). That hasn't been a
  problem for the owner; more digits means more business, "a good problem to have" (Josh, 2026-10-14).
- Allocation runs in a transaction with a uniqueness constraint on `(seasonId, number)` among non-cancelled
  bookings, which fixes legacy's read-then-write race that produced duplicates.
- **Printable labels**: the portal and admin generate the labels customers print and attach to their things:
  confirmation number (large), school color, CSS branding, and name. Colors and layout are owner settings.

## Signup drafts and funnel

- A signup **is** a `draft` Booking. It's created at the **first step that captures an email**, so it's recoverable.
- **As built (2026-10-15):** while a booking is a draft, its selected services and answers live in `bookings.draft`
  (JSON: `serviceIds`, `answers` by field key, `signerRole`, `via`, the card setup tokens). Confirmation **materializes**
  them in one transaction (`packages/api/src/services/booking-builder.ts`): persons and contact points (matched by email),
  parties and person links, `booking_services` + `field_answers`, appointments (capacity row-locked) and unassigned jobs,
  the confirmation number, and rate-card charges on the booking's **open invoice** (`draft` status). Changing your mind
  mid-signup therefore never deletes rows. The same builder powers staff "New booking" and "Add service".
- The deposit is charged **before** confirming, so a declined card consumes no number or pickup slot; if confirming
  fails afterwards, the deposit is refunded automatically.
- The pickup contract appends to the open invoice and moves it to `pending_review`, so add-ons, referral credits, and
  items are approved as one bill.
- `stepReached` (enum of wizard steps), `lastActivityAt`, `abandonedAt`, `recoveryStage`, `assignedStaffId`.
- `FunnelEvent { bookingId, step, event: viewed | completed | error, at, meta }` feeds the funnel dashboard and abandonment triggers.
- Drafts are disposable: drafts older than the season are archived, and the legacy pattern of creating an empty contract on every login is not repeated.
- See `features/signup-funnel.md`.

## Service
Catalog: summer storage, in-room pickup, short-term, moving, shipping, ship-to-school, semester/abroad, car,
winter-break car, assembly, packing, IKEA, hauling, freight.

**Signup is open all year; services come and go** (Josh, 2026-10-14). Legacy assumed every signup was
summer student storage and had staff hand-edit the form several times a year (fixed pickup choices for part of
the year, free-form dates the rest), and it collected student/school info that services like an IKEA delivery
don't need. The new model makes this data, not edits:

- `offeredFrom?`, `offeredUntil?` (timestamptz, entered in Denver time). A service with neither is year-round.
  The catalog at signup shows only services offered *now* (and at the chosen school, for student services).
- **Variants with scheduled hand-offs.** Similar services that ask different things are separate Services,
  e.g. *Student storage* (fixed pickup days) and *Off-season student storage* (customer-chosen date).
  `successorServiceId` plus the `offeredUntil`/`offeredFrom` boundary switches between them at an exact time
  with no deploy and no form editing. The admin config screen shows the year as a timeline per service family.
  A draft holding a service that has since ended is moved to its successor on resume; answers carry over by
  matching question keys, and the customer re-confirms anything that changed (price, scheduling).
- **Services are configured by the owner in admin, not hard-coded** (Josh, 2026-10-14). We build a library of
  typed fields; he composes each service from them. See *Service fields* below.
- **The wizard is assembled from the union of the selected services' fields**, so we never ask for information
  no selected service needs. A field shared by two services (e.g. the student) is asked once.
- Season assignment: student services belong to the season they're offered for; year-round services are
  assigned by appointment date (**confirm with owner** how he wants year-round work reported).

`Service.appointmentRules` (current production flags, which are per-service admin toggles):
- `skipPickup`: no pickup appointment (ship-to-school). The booking skips pickup only if *all* its services skip it.
- `deliveryRequired`: the customer must choose a delivery at signup.
- `deliveryFollowsPickup`: the delivery is part of the same job (moving). Ignored if any service requires a separately scheduled delivery.
- `collectsDelivery`: signup collects delivery details.
- `waivesSpecialPickupFee`, `waivesSpecialDeliveryFee`, `instructions` (shown at signup).

`availability`: on-campus / off-campus / both, per school.

### Service fields (owner-configured)
`ServiceField { serviceId, key, type, label, help, required, order, config, showIf? }` replaces legacy
`ServiceField`/`FieldAnswer`. **We own the field types; the owner owns which fields a service has.** Answers are stored
as `FieldAnswer { bookingServiceId, fieldKey, value (jsonb), refId? }`. Each type is a module in
`packages/domain` (zod schema, validator, how it renders in the portal/admin, how it renders on print/crew screens).

| Kind | Types | Notes |
|---|---|---|
| Primitive | text, long text, number, money, yes/no, single select, multi select, date, time window | Options typed in by the owner |
| Reference | `person(role)`: student, guardian, customer, payer · `school` · `residence` · `address` · `vehicle` | Creates or links real records (Person + ContactPoints with consent, Residence…), not loose text. Two services asking for `person(student)` share one answer |
| Sourced options | `service_day(type: pickup \| delivery, scope)` · `residence_of(school)` · `rate_card_item(category)` | Options come from related data: e.g. on-season student storage asks for a pickup from **that school's** capacity-managed `ServiceDay` windows; off-season storage uses a plain requested `date` field instead |
| Appointment | `appointment(type, scheduling: service_days \| customer_date)` | A sourced field that also creates the `Appointment` |

- `showIf` covers simple conditions (field X = value), nothing Turing-complete.
- Pricing hooks: a select option or number field can reference a `RateCardItem` so the live estimate and the
  invoice come from the same table.
- Fields are versioned with the service: edits apply to new drafts; confirmed bookings keep the field
  definitions they were answered against, so old answers always render.
- `Service.appointmentRules` above become derived from which appointment fields a service has, plus the fee-waiver flags.

## ServiceDay and capacity
`ServiceDay { schoolId, date, appointmentType: pickup | delivery, campusScope: on | off | both, windowId, capacity, reserved, blocked }`.
- Replaces school calendar events with the `dorm_pickup` / `off_campus_pickup` / `delivery` / `delivery_on_campus` / `delivery_off_campus` / `restrict_user_selection` flags.
- Reserving a window checks `reserved < capacity` in the same transaction (row lock). Customers see only windows with room. Staff can overbook with a reason.
- Lead time (2 days) and windows (`AM 09:30–12:30`, `PM 13:30–16:30`, `ALL 09:30–16:30`, `CUSTOM`) are season config. An on-campus dorm pickup may be **date-only** (`windowId: null`), as most legacy dorm pickups are.

## Appointment, Job, dispatch
- `Appointment { bookingId, type, date, windowId?, address (structured + geocoded), room, notes, special, status }`. This is what the customer booked.
- `Job { appointmentId, status: unassigned | offered | claimed | assigned | en_route | arrived | in_progress | completed | failed, crewId?, estDurationMin }`. This is the unit of field work.
  - Dispatchers **assign** jobs to crews, or publish them to a day's **pool** that crew leads **claim** from the app (with rules: only within the crew's area or school, and a max per crew).
- `Route { crewId, date }` holds ordered `RouteStop { jobId, seq, etaAt, arrivedAt, departedAt }`, re-optimized when jobs are added or removed. The crew's live location updates the ETAs.
- **Customer queue view** is derived: "You're stop 4 of 9 for the Blue crew; current ETA 11:20", plus a map pin when the crew is en route to *you* (and only then, for privacy).
- Rescheduling an appointment to another date unassigns its job (legacy rule).
- **Staff structure is configuration, not assumption** (Josh, 2026-10-14; size unknown and changes daily):
  - `Employee { name, phone (login), defaultRoles[], active }`. `CrewRole` is an owner-defined list (seeded: lead, driver, mover, warehouse).
  - `Crew { date, name/color, members: (employeeId, role)[], vehicle? }` is **formed per day**. The owner or dispatcher builds the day's crews on the fly (copy yesterday's crews, drag people between crews) to absorb no-shows and staffing swings.
  - Pickups, deliveries, and other jobs are **assigned to a crew for a day**. The claimable pool is an optional mode the owner can turn on; assignment is the default.
  - `Vehicle` (optional list), `TimeEntry` (clock in/out, recorded on the crew's device).
  - `Device { name, assignedCrewId?, assignedDate? }`: company tablets assigned to a crew per day. Publishing the day's crews texts each employee their crew, report time, place, and lead (`CrewNotice` = an outbound Message).

## Items, capture, and AI pricing (`features/ai-item-pricing.md`)
- `CaptureSession { jobId, startedAt, completedAt, employeeId }`: one per pickup visit.
- `ItemPhoto { captureSessionId, itemId?, s3Key, takenAt, gps? }`.
- `Item { bookingId, rateCardItemId | null, description (required for "other"), quantity, condition, status: collected | in_storage | delivered | missing, source: crew | ai | legacy_text }`.
  One row per **line on the digital contract**: the crew picks a rate card item (or "Other" + a description)
  and a quantity, and attaches photos. "4 × large box" is one Item with quantity 4. No per-item QR labels
  (Josh, 2026-10-14); see `features/ai-item-pricing.md#why-no-labels`.
- At delivery the crew checks off each line's quantity; a shortfall marks the line `missing` (partially, by quantity) and opens a problem.
- `AiSuggestion { captureSessionId, model, promptVersion, input photo ids, output (structured), perItemConfidence, latencyMs, costMicros }`: an immutable record of what the model said.
- `StorageLocation { bookingId, warehouse, spot (free text or a configured zone/row) }`. Warehouse tracking is per
  booking, matching how a customer's things are stored together. Changes are logged like any other mutation.

## Ledger (built so it *can't* drift)

Legacy stored balances and let line items double as notes, so 37% of 2025 lines had no amount. The new ledger enforces:

1. **Balance is never stored as truth.** It's computed from the rows in `packages/domain`. A cached column is allowed only with a recompute-and-compare job that alerts on drift.
2. **Invoices are immutable once issued.** `Invoice.status: draft → pending_review → approved → issued → paid | void`. Corrections after issue are **adjustment lines with a reason**, never edits.
3. **Line items must be money, and belong to a service.** Every `LineItem` has `kind`, `amountCents`, `qty`, `unitPriceCents`, a `bookingServiceId` (or is a booking-level fee: deposit, card fee), and a `rateCardItemId` or `reason`. A charge for a service not on the booking requires adding that service first, so no line is added "willy nilly". Ad-hoc lines (no rate card item) are allowed with a reason and show up in an ad-hoc lines report so recurring ones become rate card items. Notes go in `Note`; item lists go in `Item`. A $0 line is allowed only as an explicit `included` item tied to a rate card item.
4. **Payments are allocated** to invoices. Overpayments become an explicit `CustomerCredit` (applied to the next invoice or refunded), never a silent negative balance.
5. **Closing requires zero.** A booking can't move to `closed` unless its balance is 0, or a `WriteOff` (owner role, reason, amount) zeroes it.
6. **Season close checklist**: every booking in the season is zero, written off, or on an approved payment plan.
7. **Daily reconciliation**: our `Payment`/`Refund` rows are matched against the provider (Stripe balance transactions or Authorize.net settlement batches). Unmatched rows go to an exceptions queue.
8. Card fee (3% unless waived) is a rule-generated line, not a column.
9. **Card-on-file authorization.** The business depends on charging the signup card for the final balance automatically.
   Every saved `PaymentMethod` used for later charges has a `ChargeAuthorization { paymentMethodId, payerPersonId,
   bookingId, textVersion, text, acceptedAt, ip, userAgent }` captured at signup (or when a card is updated). The card is
   saved for off-session merchant-initiated charges (Stripe `setup_future_usage: off_session`; Authorize.net CIM profile).
   Receipts and the portal's billing page restate the authorization.
10. **No release without payment.** A delivery (or any release of stored items) can't be dispatched while the booking
   has a past-due balance. The job shows as *on hold* in dispatch and the crew app; owner/office can override with a reason.

### Billing timing and collections
- **Approving an invoice is the billing schedule** (Josh, 2026-10-14). There are no per-service billing rules: when the
  owner approves an invoice (or an auto-approval rule does), it's issued and the card on file is **charged immediately**.
  For main storage he approves shortly after pickup, so payment happens before delivery in practice; abroad and other
  services are billed whenever he approves their invoices.
- **Automatic decline follow-up** replaces today's manual chasing. On a declined charge the worker sends the payer an
  email (and SMS only if they checked an SMS consent box) saying the payment failed, with a signed link to pay or update the card. A configurable
  schedule (default: retry/remind on day 0, 3, 7) re-attempts the saved card and re-sends the reminder.
- When the schedule is exhausted, the booking lands on the **Collections list** in admin for the owner to follow up
  personally (call/text from the list, outcome logged). Paying through any link removes it automatically.

`LineItem.source: manual | ai_suggested | ai_auto` with `approvedBy` / `approvedAt` records how each line came to exist.

## Referral and Promotion
- `Referral { referrerPersonId, code, link, inviteeContact?, refereeBookingId?, kind: parent | student, status: invited | signed_up | rewarded | void, rewardCents, payoutMethod: credit | gift_card | manual }`.
- **Keep legacy's rules; improve sharing** (Josh, 2026-10-14). Referrals are automatic: a signup through someone's
  unique link (or with their code) is claimed, and the discount lines are added to both bookings. Several people may
  refer the same person, but only one referral is claimed and applied on both ends (first valid one used at signup).
- Every booking gets a personal code and link automatically.
- **Better sharing:** native share sheet (Web Share API) plus direct buttons for the platforms families actually use
  (iMessage/SMS, WhatsApp, GroupMe, Facebook and parent Facebook groups, Instagram story, Snapchat, email), copy link,
  and a QR code. Prewritten text per platform; the owner can edit it. Each link carries the platform so the referral
  report shows which channels work. Prompted at good moments: after signup, on the pickup receipt
  with photos, and after delivery when the customer rates the crew 4–5.
- The self-reported "how did you hear" answer is **marketing attribution only**; it never triggers a reward. Data
  suggests it's mostly noise: 366 self-reported referrals in 2026 but only ~47 bookings with any referral discount line
  (system or manual), about 20 a year in 2022–25.
- The owner's goodwill discounts ("I should have gotten the offer") are applied in admin as a named `Promotion` or
  credit with a reason, not a freehand line, so they're reportable.
- Legacy reward rules are season config: parent referral gives both sides $25 credit; student referral gives the referee $10 off and the referrer a $25 payout.
- `Promotion` replaces `DiscountCode`.

## Messaging and marketing sync
- `Template`, `Campaign`, `Message` (one row per recipient per channel with provider status), `InboundMessage` (SMS, email, chat, voicemail transcript).
- `Conversation { personId?, channel, status: ai_handling | escalated | resolved, intent, assignedStaffId? }`; `AiReply { conversationId, model, promptVersion, articleIds[], facts, confidence, autoSent, correctedBy? }`; `KbArticle { title, body, intents[], public }` (owner-edited). See `features/customer-communication.md`.
- `CrewRating { jobId, rating, comment }` from the post-service text. Crew and employee reporting is derived from jobs, crew membership, time entries, ratings, tips, and claims (no stored scores).

## Tips
`Tip { jobId, payerPersonId, paymentId, lines: (employeeId, amountCents)[], paidOutAt? }`.
- Collected from the post-service rating link via the normal `PaymentGateway` (saved card or wallet).
- **One tip box per crew member** on that job, each pre-filled with a default (owner setting, seeded at $10) that the
  customer can change or zero out. Each employee gets exactly what the customer entered for them.
- **The crew gets the full amount**: CSS absorbs the card processing fee on tips (Josh, 2026-10-14).
- **Tips are not CSS revenue and never touch a booking's invoices or balance.** They're held as owed to employees and
  paid out through payroll (export per pay period). Payroll tax treatment is his accountant's call.

## Claims
`Claim { bookingId, submittedBy, kind: damage | missing | other, itemIds[], description, photoIds[], status: submitted | reviewing | resolved | denied, resolution?: refund | credit | payment | none, amountCents?, note, resolvedBy, resolvedAt }`.
- Submitted online within **7 days after delivery** (owner setting, default 7). Opening one sets the `claim_open` flag.
- Evidence is attached automatically: pickup photos for the lines involved, **required delivery photos**, the crews on both jobs, signatures.
- Resolution writes to the ledger like anything else: a refund, or a `CustomerCredit`, or an external payment record.
- Claims are worked as a periodic queue; no claim interrupts anyone by default (an urgent flag exists for staff).
- Transactional messages (receipts, reminders, on-my-way) come from us via SES/Twilio. **Marketing and abandonment journeys run in Mailchimp**: `MarketingSync { personId, mailchimpMemberId, tags, mergeFields, lastSyncedAt }`.
- Sending checks consent per channel, and transactional and marketing consent are tracked separately.

## AuditEvent
`{ actorType: staff | customer | employee | system | ai, actorId, entity, entityId, action, before, after, at }`, written for every mutation.

## Invariants (tests live in `packages/domain`)
- Exactly one `customer` and one `payer` party per confirmed booking; a `student` and a `guardian` contact when a booked service collects them.
- A booking can't reach `confirmed` without at least one service, every required field of its services, accepted terms, and a payment method (or staff waiver).
- A customer can only add a service that is offered at that moment; staff can add any service with a reason.
- Reserved count never exceeds capacity unless an override is recorded.
- Balance is derivable from rows at any point in time. Issued invoices never change, and a booking can't close with a non-zero balance unless there's a write-off.
- Every line item has an amount and either a rate card item or a reason.
- AI-generated lines never reach `issued` without an approval decision (human, or an auto-approval policy that recorded which rule approved it).
- An item can't be `delivered` unless it was `collected`, and delivered quantity can't exceed collected quantity.
- Messages are never sent to an opted-out contact point; marketing requires marketing consent or a lawful-basis flag.
- Session access to a booking requires a verified ContactPoint belonging to one of its parties.
