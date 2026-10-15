# Product Vision

## One line

Turn CSS from a signup form plus a spreadsheet-like back office into a system that **knows where every
customer's belongings are, every minute, and tells everyone who needs to know.**

## The problems worth solving

In the owner's order of pain (Josh, 2026-10-14), then what the legacy code and data show.

1. **The owner drowns in messages during peak season.** Most are "where are you / when will you be here" and questions already answered on the website or in an email. Only a fraction need him (`features/customer-communication.md`).
2. **Staffing is fragile.** Crews are college students and turnout varies day to day. Technology can't fix hiring, but fast day-of crew building and visible, performance-based crew pay can make the people who show up more productive.
3. **Nobody can see the stuff.** Once a crew loads a truck, the system knows nothing about the items. Parents can't see what was stored, staff can't find a box quickly in August, and damage claims come down to one person's word against another's.
4. **Billing is manual.** Crews write a paper "contract" and the owner retypes storage charges, and even the item inventory, into invoice lines by hand. Declined cards are chased manually. 37% of 2025 line items carry no amount at all; they're notes. Each booking averages 3.5 invoices and 8 lines. Declines become a status someone has to notice.
5. **Scheduling has no capacity model.** Customers can pick any open day. The only protection is an admin blacking out days once they look full. Crews get an unordered list.
6. **Status is a guess.** A single hand-set dropdown mixes "where is this job" with "has it been paid" and "is this a car." Reports built on it can't be trusted.
7. **Every customer starts from scratch each year**, and only ~20% of each season's students are returning customers. Volume fell 27% from 2022 to 2025 (see `baseline-metrics.md`).
8. **Field work happens outside the system.** The crew feature hasn't been used since July 2024. There is no crew login, no "on my way" text, and no proof of pickup or delivery, on days with up to 144 pickups.
9. **The platform is end-of-life**, and the vendor who maintains it has to work around it.

## Features (the "revolutionary" list)

Grouped by who notices them. ★ = headline features for the pitch.

### Families (portal)
- ★ **Answers without the owner**: a message at every milestone, a live status page, and an AI assistant that answers routine texts, emails, and chats from the FAQ and the customer's own booking. Only genuine problems reach the owner (`features/customer-communication.md`).
- ★ **Digital closet**: a photo of every item taken at pickup, visible in the portal all summer. Parents finally see what they're paying to store.
- ★ **Live arrival tracking**: "You're stop 4 of 9, ETA 11:20," then a live map once the crew heads to you, driven by the crew app. It's a web page like tracking an Amazon package, linked from SMS and email; no app to install (ADR-0005).
- ★ **Instant quote and transparent bill**: a price estimate at signup, and a final bill built from the crew's digital contract at pickup, line by line, with photos.
- **Self-service rescheduling** that only offers windows with real capacity left.
- **Partial delivery / ship one item**: "Ship my winter coat to Chicago in October" from the closet view.
- ★ **One-tap re-signup** for returning customers: clone last season, confirm what changed, pay with the saved card. Under 60 seconds.
- **Step-by-step signup with recovery**: shorter steps, autosave, Mailchimp follow-ups for unfinished signups, staff call lists, and live chat on the page (`features/signup-funnel.md`).
- **Everyone on the booking can get in**: the student and parent named at signup can each sign in with their own email or phone, and either can invite a second parent later. No shared passwords and no account owner to track down (ADR-0004).
- **Automated referrals**: a personal link and code, with credits applied automatically and payouts (gift card or Venmo/PayPal) sent without staff work.
- **Self-service claims**: submitted online with photos; the owner works through them in batches instead of being interrupted. Required delivery photos plus pickup photos make fraudulent claims hard.
- **Rate and tip the crew**: a one-tap rating after service, and a digital tip box per crew member for customers without cash; the crew keeps all of it.

### Office (admin)
- ★ **Dispatch board**: a map and timeline of each day's appointments. Drag stops onto crews, auto-optimize routes, and see crews' live positions.
- ★ **Warehouse management**: every booking's storage spot recorded, so anyone can find a customer's things in seconds. Delivery pick lists are generated per route.
- ★ **Photo → invoice**: crews photograph items, AI identifies them, the rate card prices them, and the owner just approves. Routine invoices auto-approve over time under rules he controls (`features/ai-item-pricing.md`).
- ★ **Books that balance**: invoices can't be quietly edited, notes can't masquerade as charges, and nothing closes with a stray balance.
- **Billing runs**: storage charges computed from the inventory and the season's rate card, charged in bulk with automatic retries and dunning emails/texts for declines.
- **Capacity planning**: per school, day, window, and appointment type, with live fill rates. Staff set limits instead of watching the calendar.
- **Customer 360**: every season, message, payment, item, and note for a student and everyone on their bookings on one screen.
- **Messaging center**: templates, segments, scheduled campaigns, delivery receipts, two-way SMS inbox, and consent/opt-out handled correctly.
- **Reports for any time frame**: pick a range (a day, a pay period, a season) and see signups, revenue, A/R, referrals, crews, ratings, tips, claims, and messages, compared with last year.
- **AI assistant (Claude)**: natural-language search ("off-campus CU pickups on May 9 with an unpaid balance"), a summary of a customer's history before a call, drafted replies to inbound texts and emails, and flags for anomalies (duplicate signups, items missing from a delivery manifest).
- **Audit trail and roles**: owner, office staff, dispatcher, and warehouse each see what they need, and every change is attributed.

### Crew (mobile)
- ★ **Today's route**: ordered stops, one-tap navigation and call/text, and "On my way" texts that automatically notify the customer with an ETA.
- ★ **Digital contract**: pick the item, set the quantity, snap a photo, customer signs. No paper, nothing retyped, works offline in dorm basements. Later, AI pre-fills it from the photos.
- ★ **Job pool**: crews get assigned, or claim, pickups, deliveries, and service calls, with routes re-optimized automatically.
- **Proof of service**: customer signature or photo at pickup and delivery, with a timestamp and location.
- **Warehouse mode**: record and look up storage spots. Load-out checks each booking's lines off against the delivery pick list.
- **Clock in/out** tied to crews and stops (payroll export).
- **Phone-number login** (SMS one-time code). No more secret links.

## How success is measured

Baselines are in [`baseline-metrics.md`](baseline-metrics.md).

| Metric | Baseline source | Expected movement |
|---|---|---|
| Signups per season, total and returning | `contracts` by year | ↑ from one-tap re-signup, referrals |
| Signup abandonment (started vs. completed) | `contracts.state != complete` | ↓ |
| Revenue per booking | invoices / contracts | ↑ from add-on upsell and accurate item billing |
| Staff touches per booking (invoices, manual lines) | 3.5 invoices, 8.1 lines/booking (2025) | ↓ via inventory-driven billing runs |
| Referral conversion (invites → signups) | 9% (2026); most referral signups bypass the system | ↑ via links/codes |
| Card decline recovery rate | `cc_declined` contracts later paid | ↑ via dunning |
| Inbound calls/texts per booking (the headline metric) | client estimate | ↓ via milestone messages, tracking, and AI first response |
| Share of inbound handled without the owner | — (not logged in legacy) | ↑ |
| Crew productivity (stops per crew-hour, on-time %) | not tracked since 2024 | ↑ |
| Claims paid | client books | ↓ via photo evidence |
| Office staff hours in peak season | client estimate | ↓ |

## Non-goals (for v1)

- **Marketing and growth campaigns.** The pitch is about revolutionizing operations. AI help with organic, email, and paid marketing is a later opportunity, not v1 (Josh, 2026-10-14). Growth-adjacent features that fall out of operations (re-signup, abandonment recovery, referrals) stay.

- Replacing the WordPress marketing site. The portal links to it, and a minimal schools/services feed can expose data to it later.
- A public price page or pricing widget for the marketing site (out of scope, Josh 2026-10-14).
- Multi-company SaaS. The design doesn't preclude it (see `open-questions.md`), but it isn't built for it.
- Native payroll or accounting. We export to whatever CSS uses (likely QuickBooks).
