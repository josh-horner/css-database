"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatCents } from "@css/ui";
import { useTRPC } from "@css/ui/trpc";

export function Pay({ token }: { token: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const page = useQuery(trpc.portal.payPage.queryOptions({ token }));
  const pay = useMutation(trpc.portal.payWithDemoCard.mutationOptions({ onSuccess: () => qc.invalidateQueries() }));
  const p = page.data;

  return (
    <main className="mx-auto min-h-full max-w-md px-4 py-6">
      <div className="mb-4 text-sm font-semibold tracking-wide text-brand">COLLEGE STUDENT STORAGE</div>
      {page.isError && <p className="text-slate-600">This payment link isn&apos;t valid.</p>}
      {p && (
        <>
          <h1 className="text-2xl font-semibold">{p.owedCents > 0 ? "Your payment didn't go through" : "You're all paid up"}</h1>
          <p className="mt-1 text-sm text-slate-500">Booking #{p.confirmationNumber}</p>
          <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
            {p.lines.map((l, i) => (
              <li key={i} className="flex justify-between gap-3 px-3 py-2">
                <span>{l.quantity} × {l.description}</span>
                <span>{formatCents(l.amountCents)}</span>
              </li>
            ))}
            <li className="flex justify-between px-3 py-2 font-semibold">
              <span>Amount due</span>
              <span>{formatCents(p.owedCents)}</span>
            </li>
          </ul>
          {p.owedCents > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-sm text-slate-600">The card ending in {p.cardLast4} was declined. Update your card to pay now.</p>
              {p.demoMode ? (
                <button onClick={() => pay.mutate({ token })} disabled={pay.isPending} className="w-full rounded-md bg-brand px-4 py-3 font-medium text-white disabled:opacity-60">
                  {pay.isPending ? "Paying…" : `Use a new card and pay ${formatCents(p.owedCents)} (demo test card)`}
                </button>
              ) : (
                <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">Secure card form goes here (Stripe Payment Element).</p>
              )}
              {pay.data?.status === "failed" && <p className="text-sm text-red-600">That didn&apos;t work. Please try another card.</p>}
            </div>
          )}
          {pay.data?.status === "succeeded" && <p className="mt-4 rounded-md bg-green-50 p-3 text-sm text-green-800">Thank you! Your payment went through and a receipt is on its way.</p>}
        </>
      )}
    </main>
  );
}
