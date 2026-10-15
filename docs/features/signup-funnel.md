# Feature: Multi-Step Signup, Abandonment Recovery, Staff Outreach

## What the legacy data says (per year, signups in `contracts` that never completed)

| Year | Drafts | Got to student info | Got to parent info | Entered a card | Card failed | Later completed anyway |
|---|---:|---:|---:|---:|---:|---:|
| 2023 | 1,012 | 99 | 82 | 31 | 10 | 18 |
| 2024 | 639 | 62 | 50 | 13 | 5 | 5 |
| 2025 | 804 | 64 | 47 | 14 | 4 | 10 |
| 2026 | 1,199 | 80 | 48 | 25 | 11 | 9 |

- **~600–1,200 people a year log in to sign up and never start the form.** Legacy creates a draft on every login. We have their email, but nobody follows up.
- **~50–100 a year fill in real details and stop**, and only 10–20% of those come back on their own.
- The single long form gives no signal about *where* people quit. Breaking it into steps fixes that.
- 50% of completed signups are done by a parent, 41% by the student, and 9% by someone else.

Illustrative only: recovering a third of the ~60 people who quit after entering details, plus 3% of the
~900 login-only drafts, would be about 45 bookings, roughly **$35K a season** at ~$810 per booking.

## Wizard

Steps (the progress bar names them):

1. **Email**, plus an optional phone with an unchecked box: **"CSS can text me if I get stuck."** Creates the draft immediately, and sends no code yet, so there's no friction.
2. **What do you need?** Only services offered right now (`domain-model.md#service`), with a live estimate. Student services ask the school first.
3. **Generated steps**: only what the selected services `collect`. For student storage that's school & residence, then people (student and a parent/guardian with consent checkboxes), then pickup. For an IKEA delivery it's just a contact and an address and date.
4. **Pickup / delivery** when a service needs one: capacity-aware windows (`service_days`) or a requested date (`customer_date`), depending on the service variant in effect.
5. **Review & pay**. Email or SMS verification happens here, right before the card. Verification is needed to attach saved cards and returning-customer data, and to protect the account.

Every step autosaves. Returning to the site via any link resumes at `stepReached`. Each step emits
`FunnelEvent`s (viewed, completed, validation error) so the admin funnel shows exactly where people stop.

Returning customers skip most of this (see `domain-model.md#returning-customer-re-signup`).

## Abandonment recovery

### Trigger
A worker marks a draft `abandoned` after N hours with no activity (start with 2h on the pickup and payment steps,
24h earlier in the funnel), within the signup season, and not already completed under another draft.

### Channels
Keep it **modest** (Josh, 2026-10-14): the owner has emailed his customers heavily for years, so the campaign is one
email, maybe a second, not a long journey.

- **Mailchimp:** we sync the Person to the owner's audience with merge fields (`FNAME`, `SCHOOL`, `STEP`, `RESUME_URL`) and a `signup-abandoned` tag. A simple one-email Customer Journey triggered by the tag sends the "finish your signup" email; he can edit its copy. Our system removes the tag and adds `signup-completed` the moment they finish. Assume he has (or will get) a plan that supports this.
- **Without marketing consent:** the same single reminder goes out as a transactional email from SES instead.
- **SMS: never automated** unless the person checked "CSS can text me if I get stuck" next to their phone. With it, they can get one reminder text, and the owner can text them from Hot leads.
- `RESUME_URL` is a signed, single-use, time-limited link that logs them in and drops them at their step.

### Consent
Legacy has **no marketing opt-in** anywhere (checked the schema, views, and frontend, 2026-10-14), so there is no
consent history to import. Background (not legal advice; have the owner's counsel confirm):

- **Email (US, CAN-SPAM):** commercial email is opt-out. Abandoned-signup emails are allowed without prior consent if
  they identify CSS, have honest subject lines, include a physical address, and honor unsubscribes promptly. Mailchimp
  enforces most of this. Best practice is still an explicit opt-in, which keeps the list clean and deliverability high.
- **SMS (TCPA):** marketing texts need prior express written consent. Abandonment texts go only to people who checked
  "CSS can text me if I get stuck".

Design: **transactional and service notifications are always sent** for anything the customer signed up for
(confirmations, reminders, scheduling, on-my-way, invoices); they are never behind the marketing checkbox. Step 1
includes a separate, unchecked "Email me tips and offers from CSS" (marketing only). With it, the person syncs to
Mailchimp as `subscribed`. Without it, they get one transactional "finish your signup" email
from us and aren't synced as subscribed.

### Business case for Mailchimp
The owner will pay for tools with a clear business case. The case: about 45 recovered bookings a season (~$35K,
illustrative, above) against a Standard plan cost in the low hundreds of dollars a year at his list size. If he'd
rather not keep Mailchimp, the same journeys can run inside our own messaging (we already send transactional email);
Mailchimp's advantage is that he can edit copy and timing himself in a familiar tool.

## Owner outreach: "Hot leads"
**The owner does the follow-up himself** (Josh, 2026-10-14), so triage by how far people got:

| Got as far as | Follow-up |
|---|---|
| Email, services | Automated only (Mailchimp journey or the one transactional email) |
| People, pickup | Automated, and listed in Hot leads at low priority |
| Review & pay, or card failed | **Hot leads, top of the list** for a personal email or call from the owner |

Hot leads is an admin queue of drafts idle for more than 2h and not completed, sorted by step reached and how soon
their school's pickup days are. Each card shows what they picked, their estimate, where they stopped, and any chat with
them, with one-click **call**, **text**, or **email** (logged to the inbox) and an outcome (`reached`, `left_vm`,
`not_interested`, `completed`). The step thresholds are owner settings.

## Live help on the page
- A **chat widget** on the signup wizard, opened proactively when someone idles more than 60s on pickup or payment, or hits the same validation error twice.
- **AI first, then the owner, then email** (Josh, 2026-10-14):
  1. The AI assistant answers every chat first, from the knowledge base and rate card. If the visitor is signed in (verified), it can also see their signup draft and bookings: what they picked, where they stopped, the estimate, appointments. It never takes payment or changes bookings.
  2. **When the owner is available**, which means he has the admin chat page open (presence, no business-hours setting), and the AI can't help or the visitor asks for a person, it hands off live to him.
  3. **When he isn't**, the AI tells the visitor the owner will follow up by email, confirms their address, and the conversation becomes an email thread in the owner's queue for when he's back.
- **Handoff includes everything**: the full AI chat history, a one-line summary of what they need, and one click to open the current signup draft and the person's full customer history.
- In admin, chats live in the **conversations workspace** (`apps/admin.md`): a list of active chats the owner switches between and replies in, with the context panel alongside.
- Build vs. buy: a hosted widget (Crisp, Intercom) is faster to launch. Building it into our inbox avoids a second staff tool. Recommendation: start with our own inbox plus a simple widget, since the inbox exists anyway for SMS. Revisit if staff want mobile chat apps.

## Measures
Funnel conversion by step and by school, abandonment recovery rate (completed within 14 days of first
reminder), outreach conversion per staff member, and chat-assisted conversions.
