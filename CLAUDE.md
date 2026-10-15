# CLAUDE.md

Guidance for Claude Code (and humans) working in this repository.

## What this is

A ground-up rebuild of the registration and back-office system for **College Student Storage (CSS)**, a
Boulder, CO storage / moving / shipping company serving ~10 Colorado colleges since 1996
(marketing site: www.csstorage.com, WordPress; current app: account.csstorage.com, Rails on Heroku).

Students (and their parents) sign up each spring; crews pick up their belongings from dorms and
off-campus housing in late April–May, CSS stores them over the summer, and delivers them back in
August. Abroad/semester storage, car storage, shipping and local moving run alongside.

The new system is a TypeScript monorepo with three apps sharing one API and one database:

| App | Users | Purpose |
|---|---|---|
| `apps/portal` | Students, parents | Sign up, pay, schedule pickup/delivery, see stored items, refer friends |
| `apps/admin` | CSS office staff | Bookings, billing, scheduling/dispatch, warehouse, messaging, reporting |
| `apps/crew` | Field + warehouse employees | Expo (React Native), Android-only APK sideloaded onto company tablets (ADR-0006): next-up task, route, on-my-way, digital contract (items + qty + photos), signatures, offline |

Start with `docs/README.md`. Everything below is the short version.

## Status

**Pitch build: signup, customer account, and back office working end to end** (2026-10-15). Built: the signup
wizard assembled from owner-configured service fields (capacity-aware pickup windows, referral/promo codes, email
verification, card + deposit, funnel events, abandonment reminder); the customer account (timeline, items with photos,
billing, reschedule, schedule delivery, invite a parent, claims, labels, sign up again, rate & tip); and admin
(Customer 360 with every staff action, new booking, Hot leads + funnel, calendar, capacity, crews, dispatch, warehouse,
invoice review, collections, claims, tips, reports, and setup: service builder, rate card, schools, seasons, promotions,
knowledge base, staff/employees/tablets, settings, services & costs). Still missing: Better Auth (ADR-0003; customers sign
in with an email/SMS code via our own `customer_sessions`, staff use a temporary signed cookie, crew tablets a device
token), staff 2FA, legacy import, Mailchimp sync, live chat widget, campaigns/templates, geocoding, print day sheets,
saved reports, the crew app's delivery check-off and clock-in. Keep this section honest.

## Repository layout

```
apps/
  portal/        Next.js — signup wizard, account, tracking /t, pay /pay, rate & tip /r — port 4102
  admin/         Next.js — back office (bookings, leads, inbox, billing, ops, reports, setup) — port 4101
  crew/          Expo (React Native) — Android crew app, sideloaded (offline outbox for contract lines/photos)
  api/           Hono server: tRPC, staff login, crew photo upload, Twilio webhook — port 4100
  worker/        pg-boss: AI replies to inbound texts, declined-payment retries, signup reminders
packages/
  domain/        Pure business logic (money, ledger, contract pricing, queue/ETA, collections, tips). No I/O.
  db/            Drizzle schema, migrations, seed (fake people only)
  api/           tRPC routers + application services (imported by apps/api; types consumed by all clients)
  integrations/  Payments (Stripe, fake), SMS (Twilio, console), email (SES, console), AI (Claude, fake), files
  ui/            Shared web pieces for portal and admin (tRPC provider, kit, field renderer, labels, map, theme)
  config/        tsconfig presets
docs/            Product, architecture, domain, migration, ADRs, demo runbook
legacy/          The old Rails app. READ-ONLY reference. See below.
```

Planned but not created yet: `packages/validators`, `tools/legacy-import`, lint config.
Web apps reach the API same-origin through Next rewrites (`/trpc`, `/auth`, `/photos`).

## Commands

```
cp .env.example .env          # first time; fakes are used when credentials are blank
pnpm install
pnpm db:up                    # Postgres 17 in docker on :5544 (css_dev; tests use css_test)
pnpm db:reset                 # drop, migrate, seed: today's demo route + next season's catalog, ~60 bookings, stalled signups
pnpm dev                      # api, worker, admin, portal via turbo
pnpm --filter @css/crew start # Expo dev server for the crew app (needs a dev build on the tablet)
pnpm test                     # vitest across workspace (packages/api runs an e2e flow against css_test)
pnpm --filter @css/domain test  # domain logic only (fast; run this constantly)
pnpm db:generate              # drizzle migration from schema changes, then pnpm db:migrate
pnpm typecheck && pnpm test   # must pass before a change is "done"
```

## The legacy app (`legacy/`)

- Rails 6.0 / Ruby 3.2 / Vue 2 / AngularJS / Postgres, 2016–2026, maintained by a third party since ~2022
  (they keep their own repo; `legacy/` was pulled from production and matches the production schema).
- **It is a reference for business rules, not a template for design.** Read `docs/legacy-analysis.md`
  before digging in; it maps where each rule lives.
- **Never copy anything from `legacy/.env`, `legacy/config/*.yml`, or rake tasks into this repo** —
  they contain live credentials. `legacy/` is git-ignored at the root and must stay that way.
- Never run legacy code, rake tasks, or migrations against any real database.
- The highest-value files: `app/models/contract.rb` (signup validation, statuses, referrals,
  confirmation numbers), `app/models/invoice.rb` + `credit_card.rb` (billing / Authorize.net CIM),
  `app/models/calendar/*.rb` (pickup/delivery windows, blackouts, SMS reminders),
  `app/models/school.rb` (available dates), `db/schema.rb`.

## Production data copy

- Local Postgres database `csstorage` is a **production copy with real PII**; a dump lives in `.data/` (git-ignored).
- Query it read-only for analysis and migration work. Never write to it, never copy rows into seeds,
  tests, fixtures, docs, or commits. Docs may contain aggregates only (see `docs/baseline-metrics.md`).
- It matches the `legacy/` code (schema `20260723160000`). If they ever disagree, the database is truth.

## Domain conventions (non-negotiable)

- **Money is integer cents** (`amountCents: number`). Never floats, never decimals in JS.
- **Time:** store `timestamptz` in UTC; business time zone is `America/Denver`. Appointments are a
  local **date + window id** (e.g. `2027-05-08` + `AM`), not a timestamp with seconds-of-day math.
  Legacy encoded windows as seconds since midnight (34200 = 9:30 AM) and had a +6h timezone repair
  hack — don't repeat either.
- **Status is not one field.** Booking lifecycle, payment state, and flags (claim open, abroad,
  car storage) are separate dimensions. Legacy `admin_state` mixed all three. See `docs/domain-model.md`.
- **Balances are derived from the ledger**, never stored as an editable number. Cache only with a
  recompute path.
- **Card data never touches our servers.** Tokenize client-side (Stripe Payment Element, or Accept.js
  on the Authorize.net fallback); the API sees only tokens. Keeps PCI scope at SAQ A.
- **Payments are provider-agnostic.** Stripe is primary and Authorize.net is a live fallback, and both can be
  active at once (each payment method remembers its provider). Never import a provider SDK outside
  `packages/integrations/payments`, never branch on provider in domain/ledger code, and don't use
  Stripe Billing or Smart Retries — we own invoices, retries, and dunning. See ADR-0002.
- **Business rules live in `packages/domain`** as pure functions with unit tests. Routers and UI call
  them; they don't reimplement them. If you find rule logic in a router or component, move it.
- **Every admin mutation writes an audit event** (who, what, before/after).
- **SMS requires recorded consent and honors STOP.** Every outbound message is a row with provider status.
- **Seasons are first-class.** A customer returns year after year; data is scoped by `seasonId`,
  not a bare `year` integer.
- **Identity is person-centric** (ADR-0004): access to a booking is derived from verified contact
  points of its parties. Never add an "account owner" concept or share logins.
- **Ledger can't drift**: issued invoices are immutable (adjust with reasoned lines), every line item is
  money (notes go in Notes, item lists in Items), overpayments become explicit credits, and a booking
  can't close with a non-zero balance without an owner write-off.
- **AI classifies, code prices.** Vision output maps to rate card items in `packages/domain`. AI-made
  lines never issue without an approval record (human or a named auto-approval rule).
- **Never delete customer data.** No purge jobs or hard deletes of business records; use status/archival flags and scope default views to recent seasons.
- Legacy rows keep a `legacyId` column for traceability through migration.

## Working style

- Small, reviewable changes. Domain logic → tests first.
- When a legacy behavior is ambiguous, write it down in `docs/open-questions.md` rather than guessing;
  the client (CSS owner) is the source of truth.
- Architecture changes get an ADR in `docs/decisions/` (copy the template). Don't silently swap a
  library chosen in an ADR.
- Keep `docs/` current: if you change the domain model, update `docs/domain-model.md` in the same change.
- Use realistic but fake data in seeds and tests — never real customer data from legacy.
