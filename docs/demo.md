# Pitch Demo Runbook

The demo is a thin vertical slice of the real system (not a throwaway prototype). It tells one story with
a crew tablet in Josh's hands and the owner's own phone. All people in it are fake (`packages/db/src/seed.ts`).

## The story (about 10 minutes)

1. **Crew tablet → "Next up".** Crew 1 has 6 pickups around CU Boulder today. Tap **On my way** on stop 1.
   Every contact on the booking gets a text with an ETA and a tracking link, and the tablet opens navigation.
2. **Owner's phone → tracking.** Stop 3 (Sofia, #103) is routed to the owner's phone (`DEMO_CUSTOMER_PHONE`).
   Open the tracking link: "3 of 6", ETA, and the crew on the map once they head to that stop. It refreshes every minute.
3. **Tablet → digital contract.** At a stop, tap **Arrived**, then **+ Add item**: pick *Large box*, quantity 4, take
   a photo; add a *Mini fridge* with a damage note; add *Other… kayak*. The customer types their name and the crew
   taps **Complete pickup**. The customer gets a text receipt listing what was picked up.
4. **Admin → Invoice review.** The contract is already a draft invoice next to its photos. Set the kayak's price,
   then **Approve & charge card**: the card on file is charged right away (3% card fee added by rule).
5. **Declined card.** Do the same for stop 5 (Ava, #105), whose test card declines. The payer gets an email and text with
   a pay link, the booking appears on **Collections** with a retry scheduled, and the pay page accepts a new (test) card.
6. **Conversations.** From the owner's phone, text the CSS number "when are you guys coming?". The assistant answers
   from the booking ("You're stop 3 of 6…") without anyone touching it. Text "my fridge got damaged" and it lands in
   **Conversations → Needs you** with a summary and the booking alongside. Reply from the inbox.
7. **Dispatch.** The map shows every stop's status and the crew's live position.

## The full walkthrough (end to end, ~25 minutes)

The pickup-day story above is the opener. The rest of the system, in the order a season happens:

1. **The owner sets up the season** (admin → Setup). *Services*: each service is built from typed questions (school,
   residence, people with text consent, a pickup day from capacity windows, choices that carry rate-card prices).
   Show the **Year timeline** (summer storage hands off to late signup on May 10) and **Preview signup form**.
   *Capacity*: windows per school and day, booked vs. capacity, click to raise or close. *Rate card*, *Promotions*,
   *Knowledge base* (what the assistant may answer from), *Settings* (which topics the assistant answers on its own).
2. **A parent signs up on their phone** (portal `/signup?ref=<code>` from a friend's link; codes are on any booking).
   Email → services → school & dorm → "who's filling this out" → pickup day (only windows with room) → review: the
   referral discount shows, a 6-digit code confirms the email (shown on screen in demo mode), a test card, the
   authorization sentence, **Pay $59 deposit and sign up** → confirmation number, labels, add to calendar, share link.
3. **Their account** (portal `/account`, sign in with a code): timeline, change pickup day, people (invite the other
   parent), billing, referral link, and after delivery: claims, rate & tip.
4. **Back office**: *Today* (what needs you), *Bookings* (search anything; Customer 360 with people, answers,
   appointments, open bill, payments, messages, history; Add service with a reason; charge/discount lines; refunds;
   write-off as owner; cancel without deleting), *New booking* for phone signups.
5. **Hot leads**: stalled signups ranked by how far they got (card declined at review = call now), with one-click
   email/text that links them back to their step, and the signup funnel by step and school.
6. **Operations**: *Calendar* (week by school color), *Crews* (copy yesterday, move people, assign and order stops,
   assign a tablet, **Publish & text crews**), *Dispatch*, *Warehouse* (shelf locations, delivery pick lists).
7. **Money**: *Invoice review* (contract + add-ons on one bill), *Collections*, *Claims* (pickup/delivery photos side by
   side, resolve as credit/refund/deny with an automatic email), *Tips* (per employee, payroll CSV), *Reports* (any
   range, group by day/school/service/crew/employee…, compare with last year, CSV).

The seed gives next summer ~60 confirmed bookings across schools, 14 stalled signups at every step (one with a declined
card), and a few referrals, so every page has something on it. Logins: owner@example.com / demo (everything) and
office@example.com / demo (office role: no setup, no write-offs, refunds up to $100).

## Setup

```
cp .env.example .env
pnpm install
pnpm db:up && pnpm db:reset      # seeds today's route; rerun the morning of the demo
pnpm dev                         # api :4100, admin :4101, portal :4102, worker
```

- Admin: http://localhost:4101 (owner@example.com / demo).
- Tracking page for stop 3: http://localhost:4102/t/demo-stop-3.
- Crew tablet pairing: server address `http://<laptop LAN IP>:4100`, device code `dev-tablet-token`
  (or `DEMO_DEVICE_TOKEN`). Set `API_URL`, `PORTAL_URL`, `ADMIN_URL` in `.env` to the LAN IP too, so links in texts work on phones.

### Real texts, payments, and AI (optional, recommended for the meeting)

| Feature | Without credentials | With credentials (`.env`) |
|---|---|---|
| SMS | Printed in the API/worker log | Twilio: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`. A trial account can only text verified numbers, so verify the owner's phone. Point the number's inbound webhook to `<public API URL>/webhooks/twilio/sms` (needs a tunnel such as `cloudflared` for a laptop) |
| Inbound texts | Admin → Conversations → "Demo: simulate a customer text" | Real replies from the owner's phone via the webhook |
| Payments | Fake gateway (stop 5 declines) | `PAYMENTS_PROVIDER=stripe`, `STRIPE_SECRET_KEY=sk_test_…` then `pnpm db:reset` (creates Stripe test customers; stop 5 uses Stripe's always-declines test card) |
| AI replies | Keyword stand-in | `ANTHROPIC_API_KEY` (model `claude-opus-5-5`, low effort, structured output) |
| Owner's phone as customer #103 | Fake number | `DEMO_CUSTOMER_PHONE=+1303…` then `pnpm db:reset` |

## Crew app on a tablet

- Release APK: `pnpm --filter @css/crew build:apk` (needs JDK 17 and the Android SDK; output in
  `apps/crew/android/app/build/outputs/apk/release/`). Sideload with `adb install -r app-release.apk`.
  The demo APK is signed with the debug key; a CSS-owned release key is needed before real use (ADR-0006).
- During development: `npx expo run:android` from `apps/crew` with the tablet plugged in.
- The app keeps the screen on, shares location while open, and queues contract lines and photos offline
  (the "waiting to sync" counter).

## Known demo shortcuts (not production behavior)

- Staff sign-in is a temporary signed cookie; Better Auth (ADR-0003) replaces it.
- The pay page's "use a new card" button attaches a test card. Production uses Stripe's hosted Payment Element.
- The customer signs by typing their name; a drawn signature comes later.
- ETAs use straight-line distance and a fixed per-stop time; a routing provider replaces this later.
- Customers sign in with a code from our own tables, not Better Auth yet (ADR-0003 "Interim implementation").
- Without Stripe keys the signup card step offers two test cards (approves / declines) instead of Stripe's card form.
- No geocoding: appointments use the residence or school's coordinates; off-campus addresses aren't mapped exactly.
- Mailchimp sync, the live chat widget, campaigns, saved reports, and printable day sheets aren't built yet.
- OpenStreetMap tiles are used for maps; production needs a commercial tile provider.
