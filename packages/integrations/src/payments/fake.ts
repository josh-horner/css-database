import type { PaymentGateway } from "./types";

/** Offline gateway. Any payment method id containing "decline" fails like a card decline. */
export function createFakeGateway(): PaymentGateway {
  let n = 0;
  return {
    provider: "fake",
    async charge(req) {
      n++;
      if (req.providerPaymentMethodId.includes("decline")) {
        return { status: "failed", providerRef: `fake_ch_${n}`, code: "card_declined", message: "Your card was declined.", retryable: true };
      }
      return { status: "succeeded", providerRef: `fake_ch_${n}` };
    },
    async createCardSetup({ email }) {
      n++;
      return { providerCustomerId: `fake_cus_${email}`, setupRef: `fake_seti_${n}`, clientSecret: null };
    },
    async completeCardSetup({ providerCustomerId, demoToken }) {
      const declines = demoToken === "fake_tok_decline";
      return {
        providerCustomerId,
        providerPaymentMethodId: declines ? "fake_pm_decline" : "fake_pm_visa",
        brand: "visa",
        last4: declines ? "0341" : "4242",
        expMonth: 12,
        expYear: 2030,
      };
    },
    async refund() {
      n++;
      return { status: "succeeded", providerRef: `fake_re_${n}` };
    },
    async createTestSavedCard({ email, behavior }) {
      return {
        providerCustomerId: `fake_cus_${email}`,
        providerPaymentMethodId: behavior === "declines" ? "fake_pm_decline" : "fake_pm_visa",
        brand: "visa",
        last4: behavior === "declines" ? "0341" : "4242",
        expMonth: 12,
        expYear: 2030,
      };
    },
  };
}
