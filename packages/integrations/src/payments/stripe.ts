import Stripe from "stripe";
import type { ChargeResult, PaymentGateway } from "./types";

/** Stripe adapter. Charges saved cards off-session with PaymentIntents; we own retries and dunning (ADR-0002). */
export function createStripeGateway(secretKey: string): PaymentGateway {
  const stripe = new Stripe(secretKey);
  return {
    provider: "stripe",
    async charge(req): Promise<ChargeResult> {
      try {
        const intent = await stripe.paymentIntents.create(
          {
            amount: req.amountCents,
            currency: "usd",
            customer: req.providerCustomerId,
            payment_method: req.providerPaymentMethodId,
            description: req.description,
            confirm: true,
            off_session: req.merchantInitiated,
          },
          { idempotencyKey: req.idempotencyKey },
        );
        if (intent.status === "succeeded") return { status: "succeeded", providerRef: intent.id };
        return {
          status: "failed",
          providerRef: intent.id,
          code: intent.status,
          message: `Payment did not complete (${intent.status})`,
          retryable: true,
        };
      } catch (err) {
        if (err instanceof Stripe.errors.StripeCardError) {
          const raw = err.raw as { payment_intent?: { id?: string } } | undefined;
          return {
            status: "failed",
            providerRef: raw?.payment_intent?.id ?? null,
            code: err.decline_code ?? err.code ?? "card_error",
            message: err.message,
            retryable: err.decline_code !== "fraudulent" && err.decline_code !== "stolen_card",
          };
        }
        throw err;
      }
    },
    async createCardSetup({ email, name }) {
      const customer = await stripe.customers.create({ email, name });
      const intent = await stripe.setupIntents.create({ customer: customer.id, usage: "off_session", allowed_payment_method_types: ["card"] });
      return { providerCustomerId: customer.id, setupRef: intent.id, clientSecret: intent.client_secret };
    },
    async completeCardSetup({ providerCustomerId, setupRef }) {
      const intent = await stripe.setupIntents.retrieve(setupRef, { expand: ["payment_method"] });
      if (intent.status !== "succeeded" || intent.customer !== providerCustomerId) throw new Error(`Card setup not complete (${intent.status})`);
      const pm = intent.payment_method as Stripe.PaymentMethod;
      return {
        providerCustomerId,
        providerPaymentMethodId: pm.id,
        brand: pm.card?.brand ?? "card",
        last4: pm.card?.last4 ?? "0000",
        expMonth: pm.card?.exp_month ?? 12,
        expYear: pm.card?.exp_year ?? 2030,
      };
    },
    async refund({ providerRef, amountCents, idempotencyKey }) {
      try {
        const refund = await stripe.refunds.create({ payment_intent: providerRef, amount: amountCents }, { idempotencyKey });
        return { status: "succeeded", providerRef: refund.id };
      } catch (err) {
        if (err instanceof Stripe.errors.StripeError) return { status: "failed", message: err.message };
        throw err;
      }
    },
    async createTestSavedCard({ email, name, behavior }) {
      if (!secretKey.startsWith("sk_test_")) throw new Error("Test cards can only be created with a Stripe test key");
      const customer = await stripe.customers.create({ email, name });
      // pm_card_chargeCustomerFail attaches fine but every charge is declined.
      const testPm = behavior === "declines" ? "pm_card_chargeCustomerFail" : "pm_card_visa";
      const pm = await stripe.paymentMethods.attach(testPm, { customer: customer.id });
      return {
        providerCustomerId: customer.id,
        providerPaymentMethodId: pm.id,
        brand: pm.card?.brand ?? "card",
        last4: pm.card?.last4 ?? "0000",
        expMonth: pm.card?.exp_month ?? 12,
        expYear: pm.card?.exp_year ?? 2030,
      };
    },
  };
}
