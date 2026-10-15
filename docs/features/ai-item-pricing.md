# Feature: Photo Capture → AI-Drafted Invoices

**Goal:** crews photograph what they pick up, a vision model identifies and sizes each item, our code prices
it from the season's rate card, and the owner **reviews and approves** instead of typing invoices from a
paper sheet. Step one is simply going paperless: crews record items on a digital contract in the crew app. Over time, routine invoices auto-approve under explicit, measurable policies.

## Why it matters (from `baseline-metrics.md`)
- Today crews fill out a written sheet, and the owner types it into invoice lines: 3.5 invoices and 8.1 lines per booking in 2025, with 37% of lines being notes rather than charges.
- Item lists exist only as free text ("3 lg boxes x $59, tv box, mattress…"). There are no photos and no record of condition, so damage and lost-item claims are one person's word against another's.
- The same photos power the customer's **digital closet** and claims evidence. One capture step serves three features.

## Flow

```
Crew app (at the stop)                 API / worker                         Owner (admin)
──────────────────────                 ────────────                         ─────────────
pick item + qty, photo(s)         ─►  upload to S3 (presigned)
"done with stop"                   ─►  enqueue ai.itemize(captureSessionId)
                                       │ Claude vision → structured items
                                       │ domain.priceItems(items, rateCard)
                                       ▼
crew sees suggested list           ◄── draft invoice (pending_review)
fixes obvious misses on site                                              review queue: photo grid
(optional, ~20s)                                                          beside proposed lines;
                                                                          approve / edit / reject
                                                                          → invoice issued → charged
```

- **The digital contract comes first; AI is an assistant to it.** Crews pick a rate card item (or "Other" + description) and a quantity, and attach photos. In assist mode the AI pre-fills those lines from the photos and the crew corrects them, especially quantities, since counting stacked boxes in a photo is error-prone.
- The crew runs the suggestion while still on site so mistakes ("that's 4 boxes, not 3") get fixed by the people who were there. If there's no signal, it runs when the tablet syncs, and the owner reviews as usual.
- Photos are per line (the boxes or the item for that line), with an optional wide "room" photo for context. The app guides framing and rejects blurry shots on device.

### Why no labels
Per-item QR labels were considered and dropped (Josh, 2026-10-14). What they would have bought: an exact item count,
per-item warehouse location (box → bin), scan-off at delivery to catch a specific missing box, and per-item claims.
What we do instead: quantity per line, photos per line, a storage location per booking, and a quantity check-off at
delivery. That matches how CSS stores a customer's things together and avoids buying, printing, and applying labels
at ~150 pickups a day. Revisit only if lost-item claims show a need.

## Model call design

- **Model:** `claude-opus-5-5` (current default; vision-capable). Validate before launch with the eval below, measuring at `low` and `medium` effort. Item classification is a routine task where lower effort may hold quality. Changing models or effort is a config change, measured by the same eval, never a guess.
- **One request per capture session** (all photos of one stop, typically 5–20 images). Seeing everything together helps the model distinguish the same item photographed twice from two different items, and gives consistent sizing.
- **Images:** resized on device to about 1568 px on the long edge as JPEG, uploaded to S3, and sent as base64 (or presigned URL). Each image is preceded by a text block with its `photoId` (and the crew's line, if already entered) so outputs can reference them.
- **Structured outputs** (`output_config.format` with a JSON schema): the response is guaranteed to parse into:
  ```
  items[]: { photoIds[], rateCardItemCode (enum from rate card) | "other", quantity, sizeClass (enum),
             description, conditionNotes, damageVisible: bool, confidence: 0–1,
             needsHuman: null | "unclear" | "not_on_rate_card" | "high_value" | "possible_duplicate" }
  notes
  ```
- **The model never sets prices.** `packages/domain` maps `(category, sizeClass)` to a `RateCardItem` and computes amounts. The model can't invent a price, a discount, or a fee, and price changes don't require prompt changes.
- **Prompt caching:** the system prompt (instructions, the season's category and size taxonomy with reference descriptions, a few labeled example photos) is static for the season. Put it first with `cache_control`, so per-session requests pay full price only for the photos.
- **Refusals/errors:** check `stop_reason` before reading content, and enable the API's server-side fallback per current guidance. Any failure leaves the session in `needs_manual`. The owner prices it by hand from the photos, which is still better than today.
- **Realtime, not Batch.** Volume is small (about 1,100 pickups per season, peaking near 150 a day), and the crew-confirmation loop needs answers within seconds. The Batch API (50% cheaper) is only worth it for re-processing history, such as re-running a new prompt over last season for evals.

## Cost ballpark (Opus 5.5 list price: $4 / MTok in, $20 / MTok out)

| Per pickup (12 photos) | Tokens | Cost |
|---|---|---|
| Images (~1,600 tokens each) | ~19K in | ~$0.08 |
| Cached system prompt + examples | ~5K cache read | <$0.01 |
| Structured output + thinking | ~2–4K out | ~$0.04–0.08 |
| **Total** | | **~$0.12–0.17** |

That's about **$150–200 per season** at current volume, which is noise against roughly $810 of revenue per booking.
Re-measure with real requests (`usage` on every response is logged to `AiSuggestion.costMicros`).

## Review UI (admin)
- A queue sorted by pickup date. Each card shows the photo strip, proposed lines with confidence badges, the rate card total, and differences from the customer's signup estimate.
- One-key approve. Inline edit of category, size, or quantity. Each edit records a **correction** (`before → after`), which becomes eval data.
- "Approve all ≥ 0.9 confidence" bulk action per day.

## Path to auto-approval (graduated autonomy)

Auto-approval is a **policy**, not a model setting. Each rule is explicit, versioned, and logged on the line it approved.

1. **Shadow (first season on the new system):** crews fill the digital contract by hand; AI suggestions are hidden. They're compared against the crew's entries as approved by the owner.
2. **Assist:** the owner approves everything, and we measure the edit rate per category.
3. **Auto-approve, narrow:** e.g. "a standard box category, confidence ≥ 0.9, the category's edit rate < 2% over the last 300 occurrences, invoice total within ±15% of the signup estimate, no damage flags, customer has no open claim." Everything else still goes to review.
4. **Widen** category by category as the data supports it. The owner can see and switch off any rule. Auto-approved invoices are still listed for spot audit, and customers can dispute a line from the portal with the photos attached.

## Evaluation
- **Ground truth source 1 (shadow season, spring 2028):** crews photograph each line and pick its item and quantity on the digital contract. The owner-approved entries are the label, already tied to the exact photo. This produces a few thousand labeled items before any customer is billed from AI output.
- **Ground truth source 2 (ongoing):** owner corrections in the review UI.
- **Metrics:** category accuracy, size-class accuracy, $ difference per invoice versus the final approved invoice, % of sessions needing no edits, and false "damage" flags.
- **Regression gate:** any prompt, model, or taxonomy change re-runs the frozen eval set (via Batch, cheaply) and must not regress before deploy. `promptVersion` is stored on every suggestion.
- Legacy invoice text (2022–2026) can't train vision because it has no photos. It does give the **taxonomy and price distribution**: what categories exist, how often, and at what price. Use it to build the category enum and to sanity-check totals.

## Identification vs. pricing (Josh, 2026-10-14)
Two options were considered: a model/prompt that learns the owner's prices directly from photos, or a model that
only identifies and an **admin-maintained pricing table** that code applies. We use the second. Prices stay
editable by the owner at any time and auditable; the AI never has to be
re-tuned for a price change. The photos + approved categories we collect are still the training/eval set for
identification, and unpriced categories the model keeps seeing become prompts to extend the rate card
(`domain-model.md#season`).

## Open questions
- Seed values for non-box items (beds, furniture, bikes, TVs, fridges). Not blocking: the owner fills these in through admin, and review overrides suggest additions.
- Customers see pickup photos (Josh, 2026-10-14). Pre-existing damage the crew notes at pickup is shown to the customer on the signature screen and the receipt. AI-generated condition notes are staff-only until a person confirms them.
- Photo retention: kept indefinitely (nothing is deleted), moved to cheaper storage after the season.
