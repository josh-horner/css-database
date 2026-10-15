"use client";
/** Week calendar of appointments by school color. Click through to reschedule from the booking. */
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { cx } from "@css/ui";
import { Button, Select, formatDate } from "@css/ui/kit";
import { useTRPC } from "@css/ui/trpc";
import { PageHeader, addDaysIso, todayIso } from "../../../components/page";

function weekStart(iso: string) {
  const d = new Date(`${iso}T12:00:00Z`);
  return addDaysIso(iso, -d.getUTCDay());
}

export default function Calendar() {
  const trpc = useTRPC();
  const [start, setStart] = useState(weekStart(todayIso()));
  const [schoolId, setSchoolId] = useState("");
  const end = addDaysIso(start, 6);
  const lookups = useQuery(trpc.admin.bookings.lookups.queryOptions()).data;
  const appts = useQuery(trpc.admin.crews.calendar.queryOptions({ from: start, to: end, schoolId: schoolId || null })).data ?? [];
  const days = Array.from({ length: 7 }, (_, i) => addDaysIso(start, i));
  return (
    <div>
      <PageHeader
        title="Calendar"
        subtitle={`${formatDate(start)} – ${formatDate(end)} · ${appts.length} appointments`}
        actions={
          <>
            <Select className="w-36" value={schoolId} onChange={(e) => setSchoolId(e.target.value)}>
              <option value="">All schools</option>
              {lookups?.schools.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.shortName}
                </option>
              ))}
            </Select>
            <Button variant="secondary" onClick={() => setStart(addDaysIso(start, -7))}>
              ←
            </Button>
            <Button variant="secondary" onClick={() => setStart(weekStart(todayIso()))}>
              This week
            </Button>
            <Button variant="secondary" onClick={() => setStart(addDaysIso(start, 7))}>
              →
            </Button>
            <input type="date" className="rounded-md border border-slate-300 px-2 text-sm" onChange={(e) => e.target.value && setStart(weekStart(e.target.value))} />
          </>
        }
      />
      <div className="grid gap-2 lg:grid-cols-7">
        {days.map((d) => {
          const list = appts.filter((a) => a.date === d);
          const counts = new Map<string, { color: string; n: number }>();
          for (const a of list) counts.set(a.school, { color: a.schoolColor, n: (counts.get(a.school)?.n ?? 0) + 1 });
          return (
            <div key={d} className={cx("min-h-40 rounded-xl border bg-white p-2", d === todayIso() ? "border-brand" : "border-slate-200")}>
              <div className="mb-1 flex items-baseline justify-between">
                <span className="text-sm font-semibold">{formatDate(d)}</span>
                <span className="text-xs text-slate-500">{list.length}</span>
              </div>
              <div className="mb-1 flex flex-wrap gap-1">
                {[...counts.entries()].map(([school, c]) => (
                  <span key={school} className="rounded px-1.5 text-[10px] font-semibold text-white" style={{ background: c.color }}>
                    {school} {c.n}
                  </span>
                ))}
              </div>
              <ul className="max-h-96 space-y-0.5 overflow-y-auto">
                {list.map((a) => (
                  <li key={a.appointmentId}>
                    <Link href={`/bookings/${a.bookingId}`} className="flex items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-slate-50">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: a.schoolColor }} />
                      <span className="w-8 shrink-0 text-slate-500">{a.windowId ?? "day"}</span>
                      <span className="truncate">
                        {a.type === "pickup" ? "↑" : a.type === "delivery" ? "↓" : "•"} #{a.confirmationNumber} {a.name}
                      </span>
                      {a.overbooked && <span className="text-red-600">!</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-slate-500">↑ pickup · ↓ delivery · ! booked over capacity</p>
    </div>
  );
}
