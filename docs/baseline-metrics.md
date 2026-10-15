# Baseline Metrics (from the legacy database)

Source: local Postgres database `csstorage` (production copy), exported 2026-10-14 to
`.data/csstorage-2026-10-14.dump` (git-ignored, contains PII). Aggregates only. No customer data appears here.

**Coverage:** the copy starts **2022-03-31**. Earlier seasons likely lived in an older Joomla site and aren't needed (Josh, 2026-10-14).
"Season" = legacy `contracts.year` (the year of signup). Dollar figures are rounded.

## Volume

| Season | Completed signups | Cancelled/deleted | Active bookings | Returning students¹ |
|---|---:|---:|---:|---:|
| 2022 | 1,632 | 289 | 1,351 | — |
| 2023 | 1,445 | 160 | 1,283 | 262 (18%) |
| 2024 | 1,234 | 120 | 1,113 | 263 (21%) |
| 2025 | 1,170 | 104 | 1,065 | 269 (23%) |
| 2026 | 1,197 | 105 | 1,096 | 234 (20%) |

¹ Student email had a completed booking in an earlier season.

- **Volume fell 27% from 2022 to 2025** and was flat in 2026. Per-booking revenue rose enough to partly offset it (below).
- By school (active, 2026): CU Boulder 693, CSU 216, DU 62 (down from 172 in 2023), Colorado College 56, Mines 54 (growing), UCCS 9, all others ≤3.
- 2026: 716 on-campus vs 381 off-campus bookings.
- Signups by month (2024–26 combined): Jan 101 · Feb 167 · **Mar 576 · Apr 1,459 · May 525** · Jun 190 · **Jul 384** · Aug 69 · Sep–Dec ~130. There is a second signup bump in July (ship-to-school, short-term, and moving services).
- **4,367 abandoned drafts** have no season, and 3,153 of them are over a year old.

## Money

| Season | Gross collected | Refunds | Avg paid per active booking |
|---|---:|---:|---:|
| 2022 | $1,060,856 | $23,563 | $686 |
| 2023 | $1,052,252 | $42,039 | $731 |
| 2024 | $943,558 | $19,474 | $787 |
| 2025 | $974,707 | $24,613 | $865 |
| 2026 (to date) | $933,729 | $22,203 | $810 |

- **Current price points**, inferred from invoice line text (code has none of this):
  - Sign-up fee/deposit **$59** (was $49 in 2022; code comment says $35).
  - Storage per box: **large $59, medium $49, small $39** (2024+; was $49/$39/$29 in 2023).
  - Moving labor priced in hours × rate ("2 guys and a truck"), plus a "past ground floor" per-minute fee.
  - In-room pickup about $75.
  - Summer car storage $1,300.
- **Card fee** (3%) collected about $25K in 2025, charged on 2,956 invoices and waived on 1,179.
- **2025 billing shape**: 3.5 invoices and 8.1 line items per booking (max 38). **37% of line items have no amount**: they're notes, item inventories ("2 lg boxes, tv box, mattress…"), or confirmations typed into the invoice.
- **Pickup → first real payment** (payments >$100 after the first pickup), in days at the 25th / 50th / 75th / 90th percentile: 2025 = 2 / 6 / 13 / 19; 2026 = 2 / 3 / 7 / 9. Billing lag is shorter than assumed; the cost is staff labor, not delay.
- **Open A/R** on active bookings: 2026 $21.8K across 93 bookings, 38 of them in a declined status. 2025 $7.5K across 36.
- **Add-ons are routine**: 99% of priced lines carry a legacy `service_id`, but ~45% (2,415 lines on 1,200 bookings in 2026) reference a service that isn't on the booking. Most of those are fee categories used as services (Deposit 2,344, Moving Fee 981, Supplies 340 across 2025–26); the real add-on services are special pickup/delivery 286, shipping 180, ship-to-school 153, short-term storage 127, in-room pickup 77, summer storage 77, abroad 44, handyman 23.
- **Invoice `failed_billing` state is barely used** (8 total). Declines are tracked through `admin_state` instead.

## Prices observed in invoices

Seed values for the rate card, mined from 2025–26 invoice line text (items and prices parsed out of free text;
the most common price shown, alternates in parentheses; n = times seen). The owner edits all of these in admin.

| Group | Item | Price | n |
|---|---|---:|---:|
| Fees | Sign-up fee / deposit (includes boxes, tape, supplies) | $59 | 2,342 |
| | In-room pick-up | $75 ($50) | 701 |
| | Special pickup | $250 ($100) | ~20 |
| | Special delivery (by school / winter) | $100 · $175 · $225 | ~60 |
| Labor | Moving, "3 guys and a truck" | $175/hr | 541 |
| | Moving, 4 movers | $225/hr | 22 |
| | Moving, 2 movers | $150/hr | 7 |
| | Past ground floor / upstairs | crew rate per minute: 15 min $43, 20 min $58, 30 min $87, 45 min $131 | ~800 |
| Boxes & bins | Small / medium / large box | $39 / $49 / $59 | thousands |
| | XL box | $79 ($69) | ~120 |
| | XXL box, wardrobe box, mattress box | $99 | ~30 |
| | TV box | $69 ($45 supplied, $79 large) | ~100 |
| | Plastic tower / bin / drawers / cart, by size S/M/L | $39 / $49 / $59 | ~700 |
| | Duffel bag by size M/L/XL; Ikea bag | $49 / $59 / $69–79; $49–59 | ~200 |
| | Suitcase | $69 ($59) | 65 |
| Furniture | Bed (frame + mattress) | $169 | 79 |
| | Mattress; box spring; couch; futon | $149 | ~130 |
| | Bed frame | $99 ($149) | 151 |
| | Headboard | $69 | 92 |
| | Desk | $79 / $99 | 117 |
| | Dresser | $99 ($79) | 86 |
| | Night stand | $59 ($69 large) | 145 |
| | Desk/office chair | $69 ($59) | 126 |
| | Coffee table; TV stand | $69; $79 | 46 |
| | End table | $59 | 20 |
| | Ottoman | $49 ($39) | 74 |
| | Bean bag chair | $79 | 13 |
| | Shelves by size S/M/L | $39 / $49 / $59 | ~120 |
| | Rug | $59 ($49, $39) | 90 |
| | Mattress topper / pad | $69 | 56 |
| Appliances | Mini/dorm fridge | $69 ($79) | 168 |
| | Microwave | $39 | 25 |
| | AC unit | $49 ($39) | 22 |
| | Fan; tower fan | $29 ($19); $39 | ~130 |
| | TV | $69 | 33 |
| | Vacuum | $49 | 19 |
| Sports & misc | Bike | $79 | 115 |
| | Ski bag, skis, snowboard (+ bag) | $69 | ~375 |
| | Boot bag; backpack; cooler | $39 | ~120 |
| | Guitar | $49 ($39) | 23 |
| | Mirror; lamp; hamper; shoe rack | $19 or $10 | ~350 |
| | Laundry basket; trash can; poster tube; folding chair | $10 | ~130 |
| Supplies | Mattress cover | $15 | ~390 |
| | Bubble wrap | $5 | ~105 |
| Other | Short-term storage | $100–$450 (varies by length/volume) | ~200 |
| | Summer car storage | $1,300 | — |
| | UPS shipping surcharges (gas, residential) | $5, $4 | ~57 |

- The "past ground floor" fee is the $175/hr crew rate prorated per minute ($2.92/min), so it's a labor line, not a separate price.
- Most small items cluster at three tiers ($10 / $19 / $29–39), which suggests a simple size-tier fallback for "Other" items.

## Operations

- **Peak days 2026**: 144 pickups on Apr 30, 136 on May 1, 115 on May 14; 125 deliveries on Aug 17, 121 on Aug 15.
- **Appointments 2026**: 1,127 pickups, 1,081 deliveries. In 2024 only 601 pickups were recorded against 1,087 deliveries, so pickups were under-recorded that year.
- **Windows (2025–26)**: AM 1,116 · PM 993 · All-day 51 · no window recorded 2,199 (mostly on-campus dorm pickups stored at midnight, i.e. a date with no time).
- **The crew feature was abandoned**: 442 crews and 41 employees in 2023, 17 crews in 2024, and none since **2024-07-23**. Crews are coordinated outside the system now.
- **Messaging (2026)**: 640 email and 213 SMS campaigns. SMS use dropped sharply after 2022 (1,286 then).
- **Referrals**: 266 invites in 2026, of which 23 (9%) converted. Yet 250 signups self-report "Parent Referral" and 116 "Student Referral". Bookings with a referral discount line (system or manual): ~20 a year in 2022–25, 47 in 2026. The self-reported answer is likely mostly noise (people pick an option to get past the question).
- **Discount codes**: used on 313 bookings in 2026, up from 82 in 2022.
- **Top signup sources (2026)**: Parent Referral 250, School Referral 168, Facebook class/parent pages 159, Student Referral 116, flyers 98, Google 80.

## Data quality (migration must handle)

| Issue | Count |
|---|---:|
| Contracts whose stored `balance` ≠ recomputed (items + card fee − successful txns) | 161 of 6,730 (Σ \|diff\| ≈ $31.7K). Owner bookkeeping noise and not a migration blocker; the new ledger prevents it |
| Duplicate confirmation numbers | 2022: 29 · 2023: 22 · 2024: 8 · 2025: 8 · 2026: 5. Nearly all pair a finished booking with an `incomplete` draft, or are a second booking for the same student (car, abroad, shipping). Not true duplicates |
| Accounts with no contracts (each login creates an account **and an Authorize.net CIM customer profile**) | 21,146 of 29,269 |
| Completed bookings where student email = parent email (rule bypassed by admins) | 179 |
| Student phone numbers not 10 digits | 38 |
| Users flagged `email_invalid` | 94 |
| Pickups dated year 9999 | 4 |
| Transactions dated before 2000 | 1 |
| Sub-cent amounts | 0 (cents conversion is safe) |

## Code vs. production

`legacy/` was pulled from production (latest commit 2026-08-11) and matches the database schema (`20260723160000`).
Since April 2026, production added per-service appointment rules (`skip_pickup`, `delivery_required`,
`delivery_follows_pickup`, `collects_delivery`, fee waivers, instructions), on/off-campus delivery days,
school signup messages, and single-use login links.

## Who signs up, and how they come back

- 2026 completed signups were submitted by a parent 601 times (50%), by the student 494 times (41%), and by someone else 102 times (9%).
- Only 260 of 5,460 accounts with bookings ever had a second login. 216 accounts have more than one student (siblings).
- Same student, same season, multiple completed bookings are common and legitimate: summer storage plus a separate car-storage, abroad, or shipping booking.

## Abandoned signups

| Year | Drafts | Reached student info | Reached parent info | Entered card | Card failed | Later completed |
|---|---:|---:|---:|---:|---:|---:|
| 2023 | 1,012 | 99 | 82 | 31 | 10 | 18 |
| 2024 | 639 | 62 | 50 | 13 | 5 | 5 |
| 2025 | 804 | 64 | 47 | 14 | 4 | 10 |
| 2026 | 1,199 | 80 | 48 | 25 | 11 | 9 |

Most drafts are a login that never started the form (legacy creates a draft on every login). See `features/signup-funnel.md`.

## Re-running

The queries are ad hoc. When `tools/legacy-import` exists, move them into `tools/legacy-import/metrics.sql`
so these numbers can be regenerated from any fresh copy.
