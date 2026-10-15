/**
 * Provider-agnostic payments (ADR-0002). Only this folder may import a provider SDK; domain and ledger code
 * never branch on provider name.
 */
export type ProviderName = "stripe" | "authorizenet" | "fake";

export interface ChargeRequest {
  providerCustomerId: string;
  providerPaymentMethodId: string;
  amountCents: number;
  /** Stable per attempt so a retried request can't double-charge. */
  idempotencyKey: string;
  description: string;
  /** Off-session charge of a saved card, authorized at signup. */
  merchantInitiated: boolean;
}

export type ChargeResult =
  | { status: "succeeded"; providerRef: string }
  | { status: "failed"; providerRef: string | null; code: string; message: string; retryable: boolean };

export interface SavedCard {
  providerCustomerId: string;
  providerPaymentMethodId: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

/** Card collection at signup: the browser confirms card details with the provider; we only see tokens. */
export interface CardSetup {
  providerCustomerId: string;
  setupRef: string;
  /** Stripe SetupIntent client secret for the Payment Element; null for the fake gateway. */
  clientSecret: string | null;
}

export type RefundResult = { status: "succeeded"; providerRef: string } | { status: "failed"; message: string };

export interface PaymentGateway {
  readonly provider: ProviderName;
  charge(request: ChargeRequest): Promise<ChargeResult>;
  /** Start saving a card for off-session use (Stripe SetupIntent, usage off_session). */
  createCardSetup(input: { email: string; name: string }): Promise<CardSetup>;
  /**
   * Finish a setup the browser confirmed. `demoToken` is only honored by the fake gateway
   * ("fake_tok_visa" | "fake_tok_decline"), standing in for the provider's hosted card fields.
   */
  completeCardSetup(input: { providerCustomerId: string; setupRef: string; demoToken?: string }): Promise<SavedCard>;
  refund(input: { providerRef: string; amountCents: number; idempotencyKey: string }): Promise<RefundResult>;
  /** Development/demo only: create a saved test card that either always succeeds or is declined when charged. */
  createTestSavedCard(input: { email: string; name: string; behavior: "succeeds" | "declines" }): Promise<SavedCard>;
}
