# CSS Platform — Documentation

| Doc | What it answers |
|---|---|
| [vision.md](vision.md) | Why rebuild, what's broken today, the features that make it worth switching, how we measure success |
| [baseline-metrics.md](baseline-metrics.md) | Measured volume, revenue, pricing, operations, and data quality from the production copy |
| [legacy-analysis.md](legacy-analysis.md) | What the current Rails app does, where each business rule lives, its known defects |
| [domain-model.md](domain-model.md) | The new data model and lifecycles, with legacy → new mapping |
| [architecture.md](architecture.md) | Monorepo layout, stack, infrastructure, integrations |
| [apps/portal.md](apps/portal.md) | Customer signup + portal requirements |
| [apps/admin.md](apps/admin.md) | Back-office requirements |
| [apps/crew.md](apps/crew.md) | Employee mobile app requirements |
| [migration.md](migration.md) | Getting the legacy data (2022+) out of legacy and cutting over safely |
| [demo.md](demo.md) | Pitch demo runbook: the story, setup, real vs. fake services, crew APK |
| [features/customer-communication.md](features/customer-communication.md) | The owner's #1 pain: proactive milestone messages, live status, AI first response on every channel, escalation-only inbox |
| [features/ai-item-pricing.md](features/ai-item-pricing.md) | Crew photos → AI itemization → rate-card pricing → owner approval → auto-approval |
| [features/signup-funnel.md](features/signup-funnel.md) | Step-by-step signup, one-email Mailchimp abandonment reminder, hot-lead outreach, live chat |
| [roadmap.md](roadmap.md) | Phases, sequencing against the storage season, MVP scope |
| [open-questions.md](open-questions.md) | Things only the client can answer — bring to the first meeting |
| [decisions/](decisions/) | Architecture Decision Records |

## Glossary

- **Season** — one storage cycle (e.g. *Summer 2027*: signups Jan–May, pickups late Apr–May, deliveries Aug). Legacy calls this `year`.
- **Booking** — one customer's signup for a season. Legacy: `Contract`.
- **Person / Party** — a human (student, parent, guardian) and their role on a booking. Access is derived from verified contact points (ADR-0004). Replaces legacy `Account`/`User`/`*Information`.
- **Job** — the unit of field work for an appointment, assigned to or claimed by a crew.
- **Residence** — where we pick up: a dorm (on-campus) or an off-campus address. Legacy: `Dorm` (with `requires_address` meaning "off-campus") and `DormOption` (Greek houses).
- **Appointment** — a scheduled pickup, delivery, move, or supply drop-off. Legacy: `Calendar::Pickup`, `Calendar::Delivery`, `Calendar::Move`.
- **Window** — the time range offered to customers on a service day (AM 9:30–12:30, PM 1:30–4:30, All Day).
- **Service day** — a date a school is open for a given appointment type, with capacity. Legacy: `Calendar::School` events with `dorm_pickup` / `off_campus_pickup` / `delivery` flags; blackouts via `restrict_user_selection`.
- **Crew** — employees assigned together on a given day. **Route** — the ordered stops a crew runs.
- **Item** — a line on the digital contract: a rate card item (or "other") × quantity, with photos (e.g. 4 × large box). *Doesn't exist in legacy, where items were invoice-line text.*
- **Contract (owner's usage)** — the crew's pickup sheet, now the digital contract in the crew app. Not the legacy `Contract` model, which is a booking.
- **Confirmation number** — the one short number the owner, staff, crews, and customer all use: on emails, calls, and the labels on the customer's things in the warehouse. Lowest free number per season from 100 (cancelled numbers are reused). No prefixes; 4 digits is fine.
