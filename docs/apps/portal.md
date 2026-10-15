# Portal (`apps/portal`) — Students & Parents

Mobile-first web app. Most signups happen on a phone, often by a parent.

## Signup flow (v1)

Design, abandonment recovery, and outreach details: `../features/signup-funnel.md`. Returning customers: `../domain-model.md#returning-customer-re-signup`.

A multi-step wizard with progress saved on every step (legacy "save for later" becomes automatic).

1. **Email** (creates a recoverable draft immediately; verification is deferred to the payment step).
2. **Services**: only those offered right now (signup is open all year; services have start/end dates and hand off to variants, e.g. student storage → off-season student storage). Student services ask the school first. Live price estimate.
3. **Generated steps**, only what the selected services collect:
   - School and residence: dorm / Greek house / off-campus address with autocomplete. Returning customers start prefilled from last season.
   - People: student and parent contacts for student services, or just the customer otherwise. Each phone gets an SMS-consent checkbox with clear copy.
   - Pickup / delivery: capacity-aware windows or a requested date, per the service variant. A paid "special pickup" outside the calendar is offered when the school allows it.
   - Per-service questions.
4. **Referrals and promo**: enter a code, or invite people later.
5. **Review and pay**: verify email/phone (code), hosted card fields, terms accepted, deposit charged. The page states
   plainly, next to the card fields and the button: **"Your card will be charged the $59 deposit now. By signing up you
   authorize CSS to charge this card for your remaining balance after pickup and for any services or fees you add."**
   The button reads "Pay $59 deposit and sign up". Acceptance is recorded (see `domain-model.md#ledger-built-so-it-cant-drift`).
6. **Done**: confirmation number, printable labels (confirmation number, school color, CSS branding), add-to-calendar, packing-kit info, share referral link.

Validation parity with legacy (see `legacy-analysis.md`): warn on a second booking for the same student and
service in a season (other services, e.g. car storage, are fine), different student/parent contacts (warning), blocked contacts, terms. Error copy should be kinder than the legacy wording.

## Account (after signup)

- **Dashboard** per booking: status timeline (confirmed → picked up → in storage → delivery scheduled → delivered), next appointment, and balance.
- **Appointments**: reschedule or cancel within lead-time rules. On the day: **queue position** ("stop 4 of 9") and ETA, then a live map once the crew is en route to you. A plain web page that refreshes every 1–2 minutes; no app (ADR-0005).
- **Digital closet**: the pickup contract's lines with their photos, any pre-existing damage noted at pickup, and a per-line "request delivery/shipping" action. Photos are shared to discourage claims for damage that existed before pickup.
- **Add a service** to an existing booking (e.g. shipping, short-term storage), and accept services staff added when acceptance is required.
- **Billing**: invoices, receipts, payment methods, pay balance, autopay toggle.
- **People & access**: see who has access to this booking, invite another parent or guardian by email or phone, and set notification preferences per person and channel (SMS, email).
- **Referrals**: personal link and code, status of each invite, rewards earned.
- **Claims**: submit a claim online within 7 days after delivery: pick the contract lines involved, describe the damage or what's missing, add photos. Pickup and delivery photos are attached automatically. The customer sees its status and gets notified when it's resolved.
- **Rate and tip**: after each pickup or delivery, a one-tap text links to rate the crew (1–5 + comment) and optionally **tip the crew** by card, Apple Pay, or Google Pay, for customers without cash. One tip box per crew member, pre-filled with a default the customer can change; each person gets the full amount.
- **Help**: FAQ links (WordPress), contact, and SMS thread history.

## Non-functional

- Lighthouse mobile ≥ 90; WCAG 2.2 AA.
- Returning-customer re-signup in under 60 seconds; a new signup in under 5 minutes.
- Works embedded via a link from WordPress (`csstorage.com/signup` → portal). Keep `account.csstorage.com` as the domain for continuity.
