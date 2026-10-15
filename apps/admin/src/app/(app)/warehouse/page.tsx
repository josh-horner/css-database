"use client";
/** Warehouse: where each booking's things are, and delivery pick lists by day. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Badge, Button, Card, Empty, Input, Tabs } from "@css/ui/kit";
import { useTRPC } from "@css/ui/trpc";
import { LIFECYCLE_TONE, PageHeader, human, todayIso } from "../../../components/page";

export default function Warehouse() {
  const [tab, setTab] = useState<"shelf" | "picks">("shelf");
  return (
    <div className="space-y-4">
      <PageHeader title="Warehouse" subtitle="Storage is tracked per booking; the confirmation number on every box is the key." />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "shelf", label: "On the shelf" }, { id: "picks", label: "Delivery pick lists" }]} />
      {tab === "shelf" ? <Shelf /> : <Picks />}
    </div>
  );
}

function Shelf() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const rows = useQuery(trpc.admin.warehouse.inStorage.queryOptions({ q })).data;
  const save = useMutation(trpc.admin.bookings.setStorageLocation.mutationOptions({ onSuccess: () => qc.invalidateQueries() }));
  return (
    <Card>
      <Input placeholder="Find by #, name, or phone" value={q} onChange={(e) => setQ(e.target.value)} className="mb-3 max-w-sm" />
      {rows?.length === 0 && <Empty>Nothing in storage yet.</Empty>}
      <table className="w-full text-sm">
        <tbody>
          {rows?.map((r) => (
            <tr key={r.id} className="border-t border-slate-100">
              <td className="py-1.5 pr-2 text-lg font-bold tabular-nums">{r.confirmationNumber}</td>
              <td className="py-1.5 pr-2">
                <Link href={`/bookings/${r.id}`} className="font-medium hover:underline">
                  {r.customerName}
                </Link>
                <div className="text-xs text-slate-500">
                  {r.school} · {r.season}
                </div>
              </td>
              <td className="py-1.5 pr-2">
                <Badge tone={LIFECYCLE_TONE[r.lifecycle]}>{human(r.lifecycle)}</Badge>
              </td>
              <td className="py-1.5">
                <div className="flex gap-1">
                  <input
                    className="w-28 rounded border border-slate-300 px-2 py-1 text-sm"
                    placeholder="Location"
                    defaultValue={r.storageLocation ?? ""}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    onBlur={(e) => e.target.value !== (r.storageLocation ?? "") && save.mutate({ id: r.id, storageLocation: e.target.value || null, checkIn: true })}
                  />
                  {r.lifecycle === "picked_up" && (
                    <Button size="sm" variant="secondary" onClick={() => save.mutate({ id: r.id, storageLocation: r.storageLocation, checkIn: true })}>
                      Check in
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Picks() {
  const trpc = useTRPC();
  const [date, setDate] = useState(todayIso());
  const picks = useQuery(trpc.admin.warehouse.pickList.queryOptions({ date })).data;
  return (
    <div className="space-y-3">
      <div className="flex gap-2 print:hidden">
        <Input type="date" className="w-40" value={date} onChange={(e) => setDate(e.target.value)} />
        <Button variant="secondary" onClick={() => window.print()}>
          Print
        </Button>
      </div>
      {picks?.length === 0 && <Empty>No deliveries this day.</Empty>}
      {picks?.map((p) => (
        <Card key={p.jobId} title={`#${p.confirmationNumber} · ${p.name}`} actions={<span className="text-sm text-slate-500">{p.crew ?? "no crew"} · stop {p.sequence ?? "—"}</span>}>
          <div className="mb-1 text-sm">
            Shelf: <strong>{p.storageLocation ?? "not recorded"}</strong> · {p.window} · {p.residence ?? p.address}
            {p.onHold && <Badge tone="red" className="ml-2">on hold: past due</Badge>}
          </div>
          <ul className="grid gap-x-6 text-sm sm:grid-cols-2">
            {p.items.map((i, k) => (
              <li key={k}>
                ☐ {i.quantity} × {i.name}
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
