# Architecture

## Principles

1. **One language end to end (TypeScript).** Three clients (two web, one Android), one API, and shared types. Coding agents work best when a change to the schema shows up as type errors everywhere it matters.
2. **Business logic is pure and lives in one place** (`packages/domain`). Apps are thin.
3. **Boring infrastructure.** Postgres does the database, job queue (pg-boss), and search (pg_trgm / FTS). There's no Redis until something proves we need it.
4. **Vendors behind interfaces** (`packages/integrations`) so payment, SMS, and email providers can be swapped, and so tests use fakes.
5. **The crew app works offline.** Dorm basements and warehouses have poor signal, so crew actions are queued locally and synced.

## Monorepo

pnpm workspaces + Turborepo. See the layout in `/CLAUDE.md`.

```
apps/portal    ─┐
apps/admin     ─┤
apps/crew (RN)─┘── tRPC client ──► apps/api (Hono) ──► packages/api (routers)
                                                   │                    │
                                      │                    ├─► packages/domain (pure rules)
                                      │                    ├─► packages/db (Drizzle/Postgres)
                                      │                    └─► packages/integrations
apps/worker (pg-boss) ────────────────┴────────────────────┘
```

| Package | Contents | Depends on |
|---|---|---|
| `domain` | pricing, capacity, lifecycle transitions, ledger math, referral rules, segment evaluation | nothing (zod only) |
| `validators` | zod input schemas shared by forms and routers | — |
| `db` | Drizzle schema, migrations, typed query helpers, seed | — |
| `api` | tRPC routers grouped by app surface: `portal.*`, `admin.*`, `crew.*`, plus auth context and audit middleware | domain, db, integrations, validators |
| `integrations` | `PaymentGateway`, `SmsProvider`, `EmailProvider`, `MarketingSync` (Mailchimp), `ItemVision` (Claude), `Geocoder`, `RouteOptimizer`, `FileStore` interfaces + real and fake implementations | — |
| `ui` | Tailwind + shadcn/ui components, shared by portal and admin | — |
| `config` | tsconfig, eslint, prettier presets | — |

## Stack choices

| Concern | Choice | Notes / ADR |
|---|---|---|
| Web apps | Next.js (App Router), React, Tailwind, shadcn/ui, TanStack Query (via tRPC) | Two separate deployables so admin can sit behind stricter auth/network rules |
| Crew app | Expo (React Native), Android only, sideloaded APK + over-the-air JS updates; expo-camera, expo-location, keep-awake | ADR-0006. Company Android tablets with GPS + cellular. No customer app (ADR-0005) |
| API | Hono on Node, tRPC v11 | ADR-0001 |
| DB | Postgres 16+, Drizzle ORM | ADR-0001 |
| Jobs | pg-boss | Reminders, billing runs, campaign sends, retries |
| Auth | Better Auth (self-hosted, Postgres) — magic link + email OTP for customers, SMS OTP for employees, email/password + TOTP 2FA (or Google SSO) for staff | ADR-0003 |
| Payments | Stripe (primary) + Authorize.net (fallback), both behind `PaymentGateway`; per-payment-method provider routing | ADR-0002. Card data never hits our servers |
| SMS | Twilio (CSS-owned account), Messaging Service with 10DLC registration | Inbound webhook → inbox; STOP handling |
| Email | Amazon SES (CSS AWS account) with React Email templates | Legacy uses SMTP via the vendor's SendGrid; Postmark is the fallback |
| Maps | Google Maps Platform (geocoding, Places autocomplete, Route Optimization API) | Alternative: Mapbox + self-hosted VROOM |
| Files | S3 in the CSS AWS account — item photos, signatures | Pre-signed uploads straight from the device |
| AI | Claude API (`@anthropic-ai/sdk`, default `claude-opus-5-5`) behind `ItemVision` / `Assistant` interfaces | Photo itemization → draft invoices (`features/ai-item-pricing.md`); admin search, summaries; **first response to customer SMS/email/chat** grounded in the knowledge base and the sender's bookings (`features/customer-communication.md`); signup chat (AI first, live handoff when the owner has the chat page open). **The model classifies; domain code prices.** Every call logs model, prompt version, usage, cost |
| Marketing | Mailchimp Marketing API (owner's existing account) | Audience sync and a `signup-abandoned` tag that triggers a one-email journey (`features/signup-funnel.md`) |
| Errors / APM | Sentry (web, API, crew app) | Replaces Honeybadger |
| Testing | Vitest (unit/integration with a Postgres testcontainer), Playwright (web e2e), Maestro (crew app on Android) | |
| CI | GitHub Actions: lint, typecheck, test, preview deploys | |

## Hosting: a CSS-owned AWS account (decided, Josh 2026-10-14)

Everything runs in an **AWS account owned by CSS**; Josh works through an IAM user (with MFA), never root.
Exact services are chosen at scaffolding (an infrastructure-as-code ADR), but the shape is:

- **API + worker + web apps**: containers on ECS Fargate (or App Runner) behind an ALB/CloudFront. Next.js apps either as containers or via a Next-on-AWS adapter (SST/OpenNext); decide at scaffolding.
- **Postgres**: RDS for PostgreSQL with point-in-time recovery, encryption at rest, private subnets only.
- **Files**: S3 in the CSS account (photos, signatures). The legacy S3 bucket currently sits in Josh's personal AWS account and is copied over during migration.
- **Email**: Amazon SES in the same account is the default, replacing the vendor-held SendGrid; Postmark stays the alternative if deliverability needs it.
- **SMS**: Twilio under a **CSS-owned** account (re-activated or new), with 10DLC brand/campaign registered to CSS. AWS End User Messaging SMS is an option but weaker for two-way inbox use.
- Infrastructure as code (CDK, SST, or Terraform) so the whole environment is reproducible and the client can hand it to anyone.
- **Environments**: `dev` (local docker-compose Postgres), `staging` (full import of real data for rehearsals and staff testing; client-owned, access limited to CSS staff and us, same security as production), `production`.
- Cost target: under $150/month outside peak, scaling for May and August.

## Operations and support

Josh provides support; the owner only cares about major bugs and outages (2026-10-14). So the system has to tell
Josh first, before the owner notices:

- **Alerts to Josh** (SMS/email): uptime checks on portal, admin, API, and the tracking page; Sentry error spikes; worker queue backlog
  or failed jobs; payment webhook failures and reconciliation exceptions; SMS/email provider failures; crew-device sync
  backlogs; AI call failure rate.
- **Release freeze** around peak days (owner calendar + capacity data, e.g. late April–mid May and mid August): fixes only,
  deployed with a one-command rollback.
- A short **runbook** in `docs/` for the likely incidents (provider outage, stuck queue, bad deploy, a crew tablet that won't sync).

## Security

- PCI SAQ A: hosted payment fields only.
- Staff RBAC enforced in tRPC middleware. The crew API is scoped to the employee's assigned routes for the day.
- Audit log on all mutations, and PII access logged for exports.
- Secrets live in the platform secret store. `.env.example` lists names only.
- Rate limiting on auth and signup. Bot protection (Turnstile) on public forms.
- Data retention: nothing is deleted (`open-questions.md` #26). Old photos move to a cheaper S3 storage class after a season; default views scope to recent seasons.

## Offline sync (crew app)

v1 approach: TanStack Query persisted cache + a durable mutation queue in SQLite (expo-sqlite). Each crew action
(`itemCaptured`, `stopArrived`, `signatureTaken`) is an idempotent command with a client-generated id,
so a retry can't create duplicate records. Photos upload separately with resumable uploads and are
linked by id.
If conflicts become common, evaluate PowerSync or ElectricSQL (would need an ADR).
