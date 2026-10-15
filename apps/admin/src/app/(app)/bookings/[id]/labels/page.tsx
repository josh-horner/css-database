"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { use, useState } from "react";
import { LabelSheet } from "@css/ui/labels";
import { Button, Input } from "@css/ui/kit";
import { useTRPC } from "@css/ui/trpc";

export default function Labels({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const trpc = useTRPC();
  const label = useQuery(trpc.admin.bookings.labels.queryOptions({ bookingId: id }));
  const [count, setCount] = useState(12);
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between gap-2 print:hidden">
        <Link href={`/bookings/${id}`} className="text-sm text-slate-500">
          ← Back
        </Link>
        <div className="flex items-center gap-2">
          <Input type="number" className="w-20" value={count} onChange={(e) => setCount(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} />
          <Button onClick={() => window.print()}>Print</Button>
        </div>
      </div>
      {label.data && <LabelSheet label={label.data} count={count} />}
    </div>
  );
}
