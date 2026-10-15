"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { formatCents, parseDollars } from "@css/ui";
import { useTRPC } from "@css/ui/trpc";

export default function ReviewPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const queue = useQuery(trpc.admin.invoices.reviewQueue.queryOptions(undefined, { refetchInterval: 5000 }));
  const [results, setResults] = useState<Record<string, string>>({});
  const invalidate = () => qc.invalidateQueries();
  const updateLine = useMutation(trpc.admin.invoices.updateLine.mutationOptions({ onSuccess: invalidate }));
  const approve = useMutation(
    trpc.admin.invoices.approve.mutationOptions({
      onSuccess: (r, vars) => {
        setResults((m) => ({
          ...m,
          [vars.invoiceId]: r.status === "succeeded" ? `Charged ${formatCents(r.amountCents)}` : `Declined: ${"message" in r ? r.message : ""} — customer notified, retry scheduled`,
        }));
        invalidate();
      },
    }),
  );

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">Invoice review</h1>
        <p className="text-sm text-slate-500">Crew contracts become draft invoices. Approving one charges the card on file immediately.</p>
      </header>
      {Object.entries(results).map(([id, text]) => (
        <div key={id} className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm">{text}</div>
      ))}
      {queue.data?.length === 0 && <p className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-slate-500">Nothing to review. New pickups show up here as crews finish them.</p>}
      {queue.data?.map((inv) => (
        <article key={inv.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">
              <Link href={`/bookings/${inv.bookingId}`} className="hover:underline">
                #{inv.confirmationNumber} · {inv.customerName}
              </Link>
            </h2>
            <span className="text-sm text-slate-500">
              {inv.pickedUpAt ? `Picked up ${new Date(inv.pickedUpAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}
              {inv.signedByName ? ` · signed by ${inv.signedByName}` : ""}
            </span>
          </div>
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="py-1">Item</th>
                <th className="py-1">Photos</th>
                <th className="py-1 text-right">Qty</th>
                <th className="py-1 text-right">Each</th>
                <th className="py-1 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {inv.lines.map((line) => (
                <tr key={line.id} className="border-t border-slate-100 align-middle">
                  <td className="py-2 pr-2">
                    {line.description}
                    {line.needsPrice && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">needs price</span>}
                  </td>
                  <td className="py-2">
                    <div className="flex gap-1">
                      {line.photoIds.map((id) => (
                        <a key={id} href={`/photos/${id}`} target="_blank" rel="noreferrer">
                          <img src={`/photos/${id}`} alt="" className="h-12 w-12 rounded object-cover" />
                        </a>
                      ))}
                    </div>
                  </td>
                  <td className="py-2 text-right">{line.quantity}</td>
                  <td className="py-2 text-right">
                    {line.needsPrice ? (
                      <PriceInput onSave={(cents) => updateLine.mutate({ lineId: line.id, unitPriceCents: cents })} />
                    ) : (
                      formatCents(line.unitPriceCents)
                    )}
                  </td>
                  <td className="py-2 text-right">{formatCents(line.quantity * line.unitPriceCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 font-medium">
                <td colSpan={4} className="py-2 text-right">Subtotal {inv.waiveCardFee ? "" : "(3% card fee added on approval)"}</td>
                <td className="py-2 text-right">{formatCents(inv.subtotalCents)}</td>
              </tr>
            </tfoot>
          </table>
          {inv.otherPhotoIds.length > 0 && (
            <div className="mt-2 flex gap-1">
              {inv.otherPhotoIds.map((id) => (
                <img key={id} src={`/photos/${id}`} alt="" className="h-12 w-12 rounded object-cover" />
              ))}
            </div>
          )}
          <div className="mt-3 flex justify-end">
            <button
              disabled={!inv.ready || approve.isPending}
              onClick={() => approve.mutate({ invoiceId: inv.id })}
              className="rounded-md bg-brand px-4 py-2 font-medium text-white disabled:opacity-50"
              title={inv.ready ? "" : "Price every line first"}
            >
              Approve &amp; charge card
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function PriceInput({ onSave }: { onSave: (cents: number) => void }) {
  const [value, setValue] = useState("");
  const cents = parseDollars(value);
  return (
    <form
      className="flex justify-end gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (cents !== null && cents >= 0) onSave(cents);
      }}
    >
      <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="$0.00" className="w-20 rounded border border-slate-300 px-2 py-1 text-right" />
      <button disabled={cents === null} className="rounded bg-slate-800 px-2 py-1 text-xs text-white disabled:opacity-40">
        Set
      </button>
    </form>
  );
}
