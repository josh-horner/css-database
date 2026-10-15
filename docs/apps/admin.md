# Admin (`apps/admin`) — Office Staff

Desktop-first. Keyboard-friendly tables, because staff live in this all day in May and August.

## Must have for cutover (parity with legacy)

| Area | Capabilities |
|---|---|
| Bookings | Search everything (name, email, phone, confirmation #, txn id) with fast trigram search. Filters by season, school, residence, lifecycle, payment status, flags, and balance. Saved views. Incomplete signups. Duplicates detection. Bulk actions (tag, message, export CSV) |
| Booking detail (Customer 360) | People and contacts, services and answers, appointments, items, ledger, messages sent and received, notes, audit history. Staff create and edit on the customer's behalf without signup validations blocking them (legacy `admin_editing`), with a recorded reason |
| Billing | **Add service** to a booking (fields, appointments, estimate, reason, optional customer acceptance), then lines under that service from the rate card or ad hoc with a reason; charge, refund/void, waive fee, apply credit or promo; transaction search; ad-hoc lines report |
| Calendar | Day/week views by school color; appointments, notes, service days; drag to reschedule |
| Crews | Employees and owner-defined crew roles. Build each day's crews on the fly (copy yesterday, drag people between crews), assign pickups/deliveries to crews for the day, notify employees |
| Messaging | Email/SMS campaigns to segments (legacy filters + more), scheduled sends, templates |
| Config | Seasons, schools, residences, rate cards, promotions, signup sources, blocked contacts, staff users and roles. **Service builder**: compose services from typed fields (incl. person, school, pickup-day pickers), set offered-from/until and successor variants, preview the resulting signup form, see the year as a timeline per service family |
| Print | Cover sheets and day sheets (PDF) as a backup if tablets fail |

## New capabilities

- **Capacity**: grid of school × date × window showing capacity/reserved, with one-click block or raise.
- **Dispatch**: map plus timeline. Assign jobs to crews or publish them to a claimable pool, auto-route, see live crew positions, and push changes to the crew app.
- **Warehouse**: storage spot per booking, customer lookup with photos, delivery pick lists by route, shortfall report.
- **Invoice review queue**: AI-drafted invoices from crew photos, shown as a photo strip beside the proposed lines. Approve, edit, or reject, with bulk approve for high confidence. Auto-approval rules are configured and audited here (`../features/ai-item-pricing.md`).
- **Hot leads**: abandoned signups that got far, with one-click call/text and outcome tracking. Includes a signup funnel dashboard and live chat in the inbox (`../features/signup-funnel.md`).
- **Ledger guardrails**: write-offs (owner only), customer credits, a season-close checklist, and a reconciliation exceptions queue.
- **Billing runs**: preview → approve → execute. Declines get automatic emails/texts with a pay-or-update-card link and retries on a schedule; bookings still unpaid after the last attempt land on a **Collections list** for the owner's manual follow-up. Past-due bookings show as on hold for delivery.
- **Conversations workspace** (the inbox): SMS, email, chat, voicemail transcripts, and crew problems in one place, threaded per person. A list of active conversations on the left that the owner switches between, the live thread in the middle (including the AI's part of any chat), and a context panel on the right with the current signup draft, bookings, and one click to full customer history. Live chats show typing. The owner counts as available for live handoff whenever this page is open. An AI assistant answers routine questions first; the default view shows only escalations. Knowledge base editor and "add to FAQ" suggestions (`../features/customer-communication.md`).
- **Rate card**: edit prices any time and attach example photos from pickups. Review overrides and unpriced AI categories surface as "add to rate card" suggestions.
- **Services & costs**: a plain-English page listing every third-party tool the system uses (Stripe/Authorize.net, Twilio, Mailchimp, Postmark, Claude, maps, hosting, S3): what it does for CSS, what it costs per month from live usage where available, and what breaks without it. Answers the owner's recurring "what is this and why am I paying for it?" questions.
- **Reports**: the owner can generate any report by picking a time frame (a day, a week, a pay period, a season, any custom range) and optionally filtering by school, service, crew, or employee. Covers signups and sources, revenue and payments, A/R and collections, referrals, capacity, crews and employees, ratings, tips, claims, and messages. Save, compare with the same range last year, export CSV. Dashboards are just saved reports.
- **Crew & employee reports**: a flexible report tool rather than fixed scorecards. Pick any date range (one day, a pay period, a season), group by employee, crew, school, or job type, and choose metrics: jobs completed, on-time arrival vs. window, time per stop, hours clocked, problems, claims, customer ratings and comments, and tips. Save reports, export CSV. The owner uses it however he wants: checking on a problem employee for a day, or deciding bonuses for a pay period.
- **Claims queue**: customer-submitted claims worked through periodically, not as interruptions. Each claim shows the pickup and delivery photos for the lines involved, the crews on each job, and the customer's history. Resolve as refund, credit, payment (check/other), or denied, with a note; the customer is notified automatically.
- **Tips**: tips received per crew/employee for a pay period, with a payout export for payroll.
- **Assistant**: natural-language search and customer history summaries (read-only to start).
- **Exports**: QuickBooks-friendly payments export; payroll export from time entries.

## Roles

`owner` (everything, including refunds over a threshold and staff management), `office` (bookings, billing,
messaging), `dispatcher` (calendar, crews, routes), `warehouse` (items, locations), `readonly`.
