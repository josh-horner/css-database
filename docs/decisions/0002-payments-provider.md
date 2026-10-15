# 0002 — Payments: Stripe primary, Authorize.net as a supported fallback

- **Status:** accepted
- **Date:** 2026-10-14

## Context
Legacy uses Authorize.net CIM through ActiveMerchant. Raw card numbers pass through the Rails server
(PCI SAQ D). Thousands of customers have stored CIM payment profiles that staff charge for balances
months after signup, so stored cards are essential.

Stripe reduces the client's risk: hosted Payment Element (SAQ A), Apple/Google Pay, Radar fraud
screening, a well-documented webhook model, and a dashboard the owner can use without us. But the
owner may decline to move, or the move may stall mid-season, so we must be able to run on
Authorize.net, or go back to it, without touching business logic.

## Decision
- Stripe is the **primary** provider: Payment Element for collection, SetupIntents and saved PaymentMethods for off-session charges, and webhooks for settlement and disputes.
- Authorize.net is a **first-class fallback**: Accept.js or Accept Hosted for tokenization, the CIM API for stored profiles and charges. It ships as a working, tested adapter, not a stub.
- Both sit behind `PaymentGateway` in `packages/integrations/payments`. The active provider for *new* payment methods is configuration (`PAYMENTS_DEFAULT_PROVIDER=stripe|authorizenet`), not code.
- **Mixed-provider operation is the normal case, not an edge case.** Every `PaymentMethod` and `Payment` row records its `provider` and provider ids, and charges route to the provider that holds that payment method. A payer whose card hasn't been migrated keeps being charged through Authorize.net while new signups use Stripe.

## Rules that keep the switch reversible
1. **Domain and ledger never import a provider SDK** or branch on provider name. Only the adapter does.
2. **We own retries and dunning.** Retry schedules and decline messaging live in `apps/worker`, so Stripe Smart Retries and Stripe Billing/Invoicing are not used. Our ledger is the source of truth; Stripe is a payment processor, not our billing system.
3. **Normalized events.** Each adapter maps provider webhooks and responses to our own `PaymentEvent` types (`succeeded`, `failed{code,retryable}`, `refunded`, `disputed`). Decline codes map to a shared set.
4. **Client-side collection is a swappable component**: `<PaymentMethodForm provider=…>` in `packages/ui` (web) and its equivalent in the portal. Pages don't embed Stripe Elements directly.
5. **No Stripe-only products in v1 scope**: no Stripe Tax, Stripe Billing, Connect, or Link-dependent flows. Apple/Google Pay is allowed because it degrades to cards on Authorize.net.
6. **Both adapters run the same contract test suite** against sandbox accounts in CI (nightly), so the fallback can't rot.

## Development and stored-card charging (Josh, 2026-10-14)
- **Assume Stripe** (Josh, 2026-10-14). Development targets a **Stripe test account** from day one (trivial to create); the Authorize.net adapter is built and
  contract-tested alongside it in case the owner won't move. Fees are roughly the same as his Authorize.net rate; the
  pitch argument is security and reduced risk.
- Charging the signup card for the final balance is the core billing flow. The signup page discloses the immediate
  deposit and the authorization to charge the card on file, and the acceptance is stored (`domain-model.md`, ledger rule 9).
  Off-session charges are flagged as merchant-initiated on both providers.

## Card data migration
- **Authorize.net → Stripe**: request a PCI-compliant export from Authorize.net to Stripe (Stripe's migration team imports it and returns an old→new id mapping). This takes weeks, so start it during the foundation phase. `tools/legacy-import` applies the mapping, creating Stripe `PaymentMethod` rows linked to the same payer Person and retiring the CIM ones.
- **Stripe → Authorize.net** (if the owner switches back): Stripe supports exporting card data to another PCI-compliant processor on request. The same mapping import applies in reverse. Until the export lands, the old CIM profiles (never deleted during the move) can still be charged.
- Never delete CIM customer or payment profiles during migration. The legacy `remove_from_authnet` behavior must not be ported.

## Alternatives considered
- **Authorize.net only**: least change for the owner, but keeps a dated API and gives up wallets and Radar.
- **Stripe with Stripe Billing doing dunning and invoices**: less code, but it locks the business model into Stripe and makes switching back a rewrite.

## Consequences
- More adapter code and two sandbox accounts to maintain.
- Fees differ between providers. The card-fee line item rate is season config, so the owner can adjust it if processing costs change.
- Disputes, refunds, and payouts reporting must be built against our ledger, not either provider's dashboard.
