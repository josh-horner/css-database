# Feature: Fewer Messages for the Owner

**The owner's biggest pain** (Josh, 2026-10-14): handling customer communication during the busy season.
Most of it is:

1. **"Where are you?" / "When will you be here?"** on pickup and delivery days.
2. **Questions the customer could have answered themselves** from the website or an email we already sent.
3. Genuine problems that need him. These are the only ones he should see.

The goal is to make (1) and (2) mostly disappear, so his attention goes to (3). This is the headline of the pitch.

## Layer 1: Prevent the question

The customer shouldn't need to ask, because we've already told them.

- **A message at every milestone.** Each one says what happens next and links to the booking's live status page:
  confirmation, packing reminder, labels to print, day-before window, on-my-way with queue position, pickup receipt
  with the item list and photos, invoice, delivery scheduling, day-of delivery, delivered. Templates are owner-editable;
  timing is per service.
- **Live status page** (`apps/portal.md`): "stop 4 of 9, ETA 11:20", the crew map once en route, what's next,
  balance, labels, and items. Every message links here, and no login is needed for the day-of view (signed link).
- **Sent to everyone on the booking** who has opted into that channel, so the parent doesn't ask the owner
  what the student was already told (ADR-0004).

## Layer 2: Answer it automatically

Every inbound SMS, email reply, and chat goes to one inbox, and an AI assistant gives the first response.

- **Grounded in two things only:**
  - An owner-edited **knowledge base** of FAQ and policy articles. It's seeded from the WordPress FAQ pages and past emails.
  - **The sender's own bookings**: appointments, queue position and ETA, balance, items, and labels.
- **Verification before booking data.** Booking data is used only when the sender is verified: an SMS from a verified phone on the booking, an email from a verified address, or a logged-in chat. Otherwise the assistant answers general questions only and offers a sign-in link.
- **Allowed actions:**
  - Answer the question.
  - Send self-service links: reschedule, pay or update card, print labels, status page.
  - Hand off to the owner.
- **Not allowed:**
  - Changing bookings, taking payments, or granting refunds or credits.
  - Quoting a price that isn't on the rate card.
  - Promising anything outside a policy article.
- **Escalation.** Anything else goes to the owner's queue with:
  - a one-line summary
  - the customer's bookings
  - the conversation so far
  - a drafted reply

  The customer is told a person will follow up. "Talk to a person" always works.
- **Graduated autonomy** (the same pattern as AI invoicing):
  1. Drafts only. Staff send every reply.
  2. Auto-send for narrow intents: where/when, hours, packing, how to pay, labels.
  3. Widen intent by intent as the measured correction rate allows.

  The owner can see every AI answer and switch any intent back to drafts.
- **Learning loop.** Questions the assistant couldn't answer are grouped weekly into "add to FAQ" suggestions. When the owner writes the article, the next person gets the answer, and the website FAQ can link to it.

## Layer 3: The owner's queue

- The inbox shows **only escalations by default**: genuine problems, unhappy customers, and anything the AI wasn't confident about. Everything else is visible but filed as resolved.
- Each conversation is threaded per Person, with the bookings alongside. Problems from crews (the crew app's Problem button) land in the same queue. Damage and lost-item claims don't: they go to the claims queue (`apps/admin.md`), which the owner works through periodically.
- **Phone:** calls are likely a big share in peak season. v1 forwards the CSS number through Twilio with voicemail transcription into the inbox, and the AI replies by SMS when the question is routine. A voice assistant is a later option, not v1.

## Measuring it

| Metric | Baseline | Target movement |
|---|---|---|
| Inbound messages per booking, peak weeks | Owner estimate (legacy doesn't log inbound) | ↓ |
| Share resolved without a human, by intent | — | ↑ as autonomy widens |
| Owner-handled conversations per peak day | Owner estimate | ↓ to genuine problems only |
| Escalations where the AI answer was wrong | — | Kept low; gates widening |

## Model use

Claude via the `Assistant` interface (`architecture.md`). A classification and answer step uses structured output
(`intent`, `confidence`, `answer`, `links[]`, `escalate`, `reason`) and is grounded with retrieved knowledge-base
articles and booking facts. Booking facts come from `packages/domain` read models, never from the model's memory.
Every response logs the model, prompt version, cost, and the articles and facts it used. Changes go through an eval set
built from real (anonymized) inbox threads and owner corrections.
