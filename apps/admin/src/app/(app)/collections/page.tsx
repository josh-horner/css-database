"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { cx, formatCents } from "@css/ui";
import { useTRPC } from "@css/ui/trpc";

export default function CollectionsPage() {
  const trpc = useTRPC();
  const rows = useQuery(trpc.admin.collections.queryOptions(undefined, { refetchInterval: 5000 }));
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">Collections</h1>
        <p className="text-sm text-slate-500">
          Declined cards are retried automatically (day 0, 3, 7) with an email and text each time. Anything still unpaid lands here for you.
        </p>
      </header>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Owed</th>
              <th className="px-3 py-2">Attempts</th>
              <th className="px-3 py-2">Next retry</th>
              <th className="px-3 py-2">Pay link</th>
            </tr>
          </thead>
          <tbody>
            {rows.data?.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-500">No declined payments.</td>
              </tr>
            )}
            {rows.data?.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium">{r.confirmationNumber}</td>
                <td className="px-3 py-2">
                  <Link href={`/bookings/${r.bookingId}`} className="hover:underline">
                    {r.customerName}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <span
                    className={cx(
                      "rounded-full px-2 py-0.5 text-xs font-semibold",
                      r.status === "collections" ? "bg-red-100 text-red-800" : r.status === "retrying" ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800",
                    )}
                  >
                    {r.status === "collections" ? "call them" : r.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">{formatCents(r.owedCents)}</td>
                <td className="px-3 py-2">{r.failedAttempts} · {r.lastFailure}</td>
                <td className="px-3 py-2">{r.nextAttemptAt ? new Date(r.nextAttemptAt).toLocaleDateString() : "—"}</td>
                <td className="px-3 py-2">
                  <a className="text-brand underline" href={r.payLink} target="_blank" rel="noreferrer">open</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
