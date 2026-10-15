"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { formatCents } from "@css/ui";
import { Card, Stat } from "@css/ui/kit";
import { useTRPC } from "@css/ui/trpc";
import { PageHeader } from "../../../components/page";

export default function Dashboard() {
  const trpc = useTRPC();
  const d = useQuery(trpc.admin.dashboard.queryOptions(undefined, { refetchInterval: 30_000 })).data;
  const counts = useQuery(trpc.admin.counts.queryOptions()).data;
  const dispatch = useQuery(trpc.admin.dispatch.queryOptions(undefined, { refetchInterval: 30_000 })).data;
  const todo = [
    { n: counts?.escalated, label: "conversations need you", href: "/inbox" },
    { n: counts?.review, label: "invoices to review", href: "/review" },
    { n: counts?.leads, label: "hot leads to call", href: "/leads" },
    { n: counts?.collections, label: "declined payments", href: "/collections" },
    { n: counts?.claims, label: "open claims", href: "/claims" },
  ].filter((t) => t.n);
  return (
    <div className="space-y-5">
      <PageHeader title="Today" subtitle={d?.today} />
      <Card title="Needs you">
        {todo.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing waiting. The assistant and the automatic follow-ups have it covered.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {todo.map((t) => (
              <li key={t.href}>
                <Link href={t.href} className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 hover:border-amber-400">
                  <span className="text-2xl font-semibold text-amber-800">{t.n}</span>
                  <span className="text-sm text-amber-900">{t.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Appointments today" value={d ? `${d.done_today} / ${d.appts_today}` : "—"} hint="done / scheduled" />
        <Stat label="Signups, last 7 days" value={d?.signups_7d ?? "—"} hint={d ? `${d.drafts_7d} started but not finished` : undefined} />
        <Stat label="Collected, last 7 days" value={d ? formatCents(d.revenue_7d) : "—"} />
        <Stat label="Customer texts, last 7 days" value={d?.inbound_7d ?? "—"} hint={d ? `${d.ai_answered_7d} answered by the assistant` : undefined} />
      </div>
      <Card title="Crews today" actions={<Link href="/dispatch" className="text-sm text-brand underline">Dispatch map</Link>}>
        {dispatch?.crews.length === 0 && <p className="text-sm text-slate-500">No crews today. <Link href="/crews" className="text-brand underline">Build crews</Link></p>}
        <ul className="space-y-2">
          {dispatch?.crews.map((c) => {
            const done = c.stops.filter((s) => s.status === "completed").length;
            return (
              <li key={c.id} className="flex items-center gap-3">
                <span className="h-3 w-3 rounded-full" style={{ background: c.color }} />
                <span className="w-24 font-medium">{c.name}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full bg-green-500" style={{ width: `${c.stops.length ? (done / c.stops.length) * 100 : 0}%` }} />
                </div>
                <span className="w-16 text-right text-sm text-slate-600">
                  {done}/{c.stops.length}
                </span>
              </li>
            );
          })}
        </ul>
        {!!dispatch?.unassigned && <p className="mt-2 text-sm text-amber-700">{dispatch.unassigned} stop(s) today aren't on a crew yet.</p>}
      </Card>
    </div>
  );
}
