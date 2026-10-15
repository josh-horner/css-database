# Roadmap

The business is seasonal, and the calendar drives everything:

```
        Jan  Feb  Mar  Apr  May  Jun  Jul  Aug  Sep  Oct  Nov  Dec
signups ░░░░░████████████████░░░░████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  (open all year; peaks Mar–May, bump in Jul)
pickups                 ░██████
storage                      ████████████████
delivery                                    ██████
quiet                                            ████████████████  ← safe to cut over
```

Today is **2026-10-14**.

**One system at a time** (Josh, 2026-10-14). There is no period where legacy and the new system each own part
of the business. Cutover means importing and restructuring all of legacy's data into the new system, which
from that moment is the only system anyone uses. Legacy stays read-only for reference.

So everything needed to run a full season (signup, payments, admin, crew app, billing, messaging) ships together
at cutover, and all risk reduction happens **before** it: repeated rehearsal imports, staff using staging with real
imported data, and a dress rehearsal of a pickup day.

**Recommended cutover: the quiet window after August 2027 deliveries.** The first season on the new system is
spring 2028. An earlier cutover (Jan–Feb 2027, before spring pickups) is possible but compresses building,
payment testing, and import verification into about three months over the holidays, with no quiet window to
recover in if something goes wrong. Choose this only if the owner is in acute pain with the current vendor.

## Phase 0 — Pitch & discovery (Oct–Nov 2026)
- Walk the owner through `vision.md`. Agree on the problems and success metrics.
- Get written authorization and confirm ownership of the database copy we already have (`baseline-metrics.md`).
- Answer `open-questions.md`.
- **Show tracking working**, not just mocked: a crew tablet on a short demo route driving the customer tracking page (queue position, ETA, map) live, plus the digital contract and the owner's conversations inbox. Reducing "where are you" calls is what sells the tablets and data plans.

## Phase 1 — Foundation (Nov 2026–Feb 2027)
- Scaffold the monorepo, CI, environments, auth, audit, and the domain package with ledger and capacity rules.
- `tools/legacy-import` producing a full, verified import into staging from any fresh backup.
- Develop against a Stripe test account now; the client's live Stripe account follows his approval. Both payment adapters pass the contract test suite. Time the Authorize.net → Stripe card export so it lands before cutover.
- CSS-owned AWS account (Josh as IAM user), CSS-owned Twilio account with 10DLC registration started (multi-week lead time), SES domain verification. Move the `csstorage.com` Route 53 hosted zone from Josh's AWS account into the CSS account.
- Service builder and rate card in admin, so the owner can start configuring his real services early.

## Phase 2 — Build everything for a season (Mar–Jul 2027)
- **Portal**: step signup built from service fields, re-signup, people & access, billing, closet, tracking page.
- **Customer communication** (the owner's #1 pain): milestone messages, live status page, unified inbox, knowledge base, and the AI assistant answering where/when and FAQ intents (drafts first, auto-send for narrow intents by spring 2028).
- **Admin**: Customer 360, billing runs, declines and Collections list, ledger guardrails, dispatch, capacity, messaging and inbox, hot leads, Mailchimp sync.
- **Crew app**: jobs and route, job pool, on-my-way, digital contract (rate card items + photos + quantity), signatures, offline sync, on company Android tablets.
- The owner and staff watch the live 2027 season in legacy and check each workflow against it in staging with that season's imported data.

## Phase 3 — Rehearse and cut over (Aug–Oct 2027)
- Re-import from fresh backups weekly. Staff do their real daily tasks in staging alongside legacy and report differences.
- Dress rehearsal: a crew runs a mock pickup day on tablets against staging.
- Cutover in the quiet window (`migration.md#cutover`): freeze legacy, run the final import, verify, switch DNS. From then on, everything happens in the new system.
- **Spring 2028 signups, pickups, billing, and deliveries run entirely on the new platform.**

## Phase 4 — AI and growth (2028)
- **AI shadow mode** in spring 2028 pickups: crews fill the digital contract by hand, and the model itemizes the same photos silently. Owner-approved contracts are the ground-truth eval set.
- **AI assist** once the eval supports it: suggestions pre-fill the contract and the owner's review queue.
- First narrow auto-approval rules for AI invoices, widened as the data supports it.
- Widen AI auto-replies intent by intent; voice assistant for calls; automated referral payouts, ship-one-item, advanced dashboards.
