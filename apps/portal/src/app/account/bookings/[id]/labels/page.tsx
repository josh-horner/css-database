"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { use } from "react";
import { LabelSheet } from "@css/ui/labels";
import { Button } from "@css/ui/kit";
import { useTRPC } from "@css/ui/trpc";

export default function Labels({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const trpc = useTRPC();
  const label = useQuery(trpc.portal.account.labels.queryOptions({ bookingId: id }, { retry: false }));
  return (
    <main className="mx-auto max-w-3xl p-4 print:p-0">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href={`/account/bookings/${id}`} className="text-sm text-slate-500">
          ← Back
        </Link>
        <Button onClick={() => window.print()}>Print</Button>
      </div>
      <p className="mb-3 text-sm text-slate-600 print:hidden">Print on plain paper, cut, and tape one to every box and item. Writing the number on with a marker works too.</p>
      {label.data && <LabelSheet label={label.data} />}
      {label.isError && <p className="text-slate-600">Sign in to print labels for this booking.</p>}
    </main>
  );
}
