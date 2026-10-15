"use client";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { formatCents } from "@css/ui";
import { Badge, Button, Empty, Input, Select, download, formatDate } from "@css/ui/kit";
import { useTRPC } from "@css/ui/trpc";
import { LIFECYCLE_TONE, PAYMENT_TONE, PageHeader, human } from "../../../components/page";

const LIFECYCLES = ["active", "draft", "confirmed", "picked_up", "in_storage", "delivery_scheduled", "delivered", "closed", "cancelled"] as const;
const FLAGS = ["abroad", "car_storage", "short_term", "claim_open", "needs_info", "vip"];

export default function BookingsPage() {
  return (
    <Suspense>
      <Bookings />
    </Suspense>
  );
}

function Bookings() {
  const trpc = useTRPC();
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [debounced, setDebounced] = useState(q);
  const [seasonId, setSeasonId] = useState<string>("");
  const [schoolId, setSchoolId] = useState<string>("");
  const [serviceId, setServiceId] = useState<string>("");
  const [lifecycle, setLifecycle] = useState<(typeof LIFECYCLES)[number]>("active");
  const [flag, setFlag] = useState("");
  const [page, setPage] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setPage(0), [debounced, seasonId, schoolId, serviceId, lifecycle, flag]);
  const lookups = useQuery(trpc.admin.bookings.lookups.queryOptions()).data;
  const filters = { q: debounced, seasonId: seasonId || null, schoolId: schoolId || null, serviceId: serviceId || null, lifecycle, flag: flag || null };
  const list = useQuery(trpc.admin.bookings.list.queryOptions({ ...filters, limit: 50, offset: page * 50 }, { placeholderData: keepPreviousData }));
  const csv = useMutation(trpc.admin.bookings.csv.mutationOptions({ onSuccess: (text) => download(`css-bookings-${new Date().toISOString().slice(0, 10)}.csv`, text) }));

  return (
    <div>
      <PageHeader
        title="Bookings"
        subtitle={list.data ? `${list.data.total} match` : undefined}
        actions={
          <>
            <Button variant="secondary" onClick={() => csv.mutate(filters)} loading={csv.isPending}>
              Export CSV
            </Button>
            <Link href="/bookings/new" className="rounded-md bg-brand px-3.5 py-2 text-sm font-medium text-white">
              New booking
            </Link>
          </>
        }
      />
      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <Input className="lg:col-span-2" placeholder="Name, email, phone, #, code, or transaction id" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <Select value={seasonId} onChange={(e) => setSeasonId(e.target.value)}>
          <option value="">All seasons</option>
          {lookups?.seasons.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Select value={schoolId} onChange={(e) => setSchoolId(e.target.value)}>
          <option value="">All schools</option>
          {lookups?.schools.map((s) => (
            <option key={s.id} value={s.id}>
              {s.shortName}
            </option>
          ))}
        </Select>
        <Select value={lifecycle} onChange={(e) => setLifecycle(e.target.value as typeof lifecycle)}>
          {LIFECYCLES.map((l) => (
            <option key={l} value={l}>
              {l === "active" ? "Active (not draft/cancelled)" : human(l)}
            </option>
          ))}
        </Select>
        <div className="flex gap-2">
          <Select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            <option value="">Any service</option>
            {lookups?.services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Select value={flag} onChange={(e) => setFlag(e.target.value)}>
            <option value="">Any flag</option>
            {FLAGS.map((f) => (
              <option key={f} value={f}>
                {human(f)}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">School</th>
              <th className="px-3 py-2">Services</th>
              <th className="px-3 py-2">Next</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.rows.map((r) => (
              <tr key={r.id} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => router.push(`/bookings/${r.id}`)}>
                <td className="px-3 py-2 font-semibold tabular-nums">{r.confirmationNumber ?? "—"}</td>
                <td className="px-3 py-2">
                  <Link href={`/bookings/${r.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                    {r.customerName}
                  </Link>
                  <div className="text-xs text-slate-500">{r.season}</div>
                </td>
                <td className="px-3 py-2">
                  {r.school && (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.schoolColor ?? undefined }} />
                      {r.school}
                    </span>
                  )}
                  <div className="text-xs text-slate-500">{r.residence}</div>
                </td>
                <td className="px-3 py-2 text-xs">{r.services.join(", ")}</td>
                <td className="px-3 py-2 text-xs">{r.nextAppointment ? `${r.nextAppointment.type} ${formatDate(r.nextAppointment.date)}` : "—"}</td>
                <td className="space-x-1 px-3 py-2">
                  <Badge tone={LIFECYCLE_TONE[r.lifecycle]}>{human(r.lifecycle)}</Badge>
                  {r.flags.map((f) => (
                    <Badge key={f} tone="amber">
                      {human(f)}
                    </Badge>
                  ))}
                </td>
                <td className="px-3 py-2 text-right">
                  {r.balanceCents !== 0 && <div>{formatCents(r.balanceCents)}</div>}
                  <Badge tone={PAYMENT_TONE[r.paymentStatus]}>{human(r.paymentStatus)}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.data?.rows.length === 0 && <Empty>No bookings match.</Empty>}
      </div>
      {list.data && list.data.total > 50 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span>
            {page * 50 + 1}–{Math.min((page + 1) * 50, list.data.total)} of {list.data.total}
          </span>
          <Button variant="secondary" size="sm" disabled={(page + 1) * 50 >= list.data.total} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
