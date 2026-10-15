"use client";
/**
 * Card step. With Stripe configured, Stripe's Payment Element collects the card in an iframe (card data never
 * touches our servers; SAQ A) and confirms a SetupIntent for off-session use. Without Stripe (demo/dev), the
 * customer picks a test card instead.
 */
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { cx } from "@css/ui";
import { Alert, Button, errorText } from "@css/ui/kit";
import { useTRPC } from "@css/ui/trpc";

export interface CardResult {
  /** Confirms the card with the provider right before signup completes. Returns false if it failed. */
  confirm: () => Promise<boolean>;
  demoToken?: "fake_tok_visa" | "fake_tok_decline";
}

const stripeCache = new Map<string, Promise<Stripe | null>>();

export function CardStep({
  payments,
  disabled,
  onReady,
  ready,
}: {
  payments: { provider: string; publishableKey: string | null; demoMode: boolean };
  disabled: boolean;
  onReady: (r: CardResult | null) => void;
  ready: CardResult | null;
}) {
  const trpc = useTRPC();
  const setup = useMutation(trpc.portal.signup.cardSetup.mutationOptions());
  useEffect(() => {
    if (!disabled && !setup.data && !setup.isPending) setup.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  if (disabled) return <p className="text-sm text-slate-500">Confirm your email first.</p>;
  if (setup.error) return <Alert>{errorText(setup.error)}</Alert>;
  if (!setup.data) return <p className="text-sm text-slate-500">Loading secure card form…</p>;

  if (setup.data.provider === "stripe" && setup.data.clientSecret && setup.data.publishableKey) {
    return <StripeCard publishableKey={setup.data.publishableKey} clientSecret={setup.data.clientSecret} onReady={onReady} />;
  }
  return <DemoCard onReady={onReady} ready={ready} />;
}

function StripeCard({ publishableKey, clientSecret, onReady }: { publishableKey: string; clientSecret: string; onReady: (r: CardResult | null) => void }) {
  const stripe = useMemo(() => {
    if (!stripeCache.has(publishableKey)) stripeCache.set(publishableKey, loadStripe(publishableKey));
    return stripeCache.get(publishableKey)!;
  }, [publishableKey]);
  return (
    <Elements stripe={stripe} options={{ clientSecret, appearance: { theme: "stripe", variables: { colorPrimary: "#1d4ed8" } } }}>
      <StripeInner onReady={onReady} />
    </Elements>
  );
}

function StripeInner({ onReady }: { onReady: (r: CardResult | null) => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <PaymentElement
        onChange={(e) => {
          if (!e.complete || !stripe || !elements) return onReady(null);
          onReady({
            confirm: async () => {
              setError(null);
              const result = await stripe.confirmSetup({ elements, redirect: "if_required" });
              if (result.error) {
                setError(result.error.message ?? "Your card couldn't be saved");
                return false;
              }
              return true;
            },
          });
        }}
      />
      <Alert>{error}</Alert>
    </div>
  );
}

function DemoCard({ onReady, ready }: { onReady: (r: CardResult | null) => void; ready: CardResult | null }) {
  const pick = (demoToken: "fake_tok_visa" | "fake_tok_decline") => onReady({ demoToken, confirm: async () => true });
  return (
    <div className="space-y-2">
      <Alert tone="amber">Demo mode: no real card form. Pick a test card.</Alert>
      <div className="grid gap-2 sm:grid-cols-2">
        {(
          [
            ["fake_tok_visa", "Visa •••• 4242", "Approves"],
            ["fake_tok_decline", "Visa •••• 0341", "Declines"],
          ] as const
        ).map(([token, label, note]) => (
          <button
            key={token}
            type="button"
            onClick={() => pick(token)}
            className={cx("rounded-md border px-3 py-2 text-left text-sm", ready?.demoToken === token ? "border-brand bg-brand/10 ring-2 ring-brand/30" : "border-slate-300 bg-white")}
          >
            <span className="block font-medium">{label}</span>
            <span className="text-xs text-slate-500">{note}</span>
          </button>
        ))}
      </div>
      {ready && (
        <Button variant="ghost" size="sm" onClick={() => onReady(null)}>
          Clear
        </Button>
      )}
    </div>
  );
}
