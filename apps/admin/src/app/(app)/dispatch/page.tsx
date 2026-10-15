"use client";
import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { cx } from "@css/ui";
import { useTRPC } from "@css/ui/trpc";

const PinMap = dynamic(() => import("@css/ui/map").then((m) => m.PinMap), { ssr: false });

const STATUS_COLOR: Record<string, string> = {
  completed: "#16a34a",
  arrived: "#9333ea",
  en_route: "#2563eb",
  assigned: "#64748b",
  unassigned: "#94a3b8",
  failed: "#dc2626",
  on_hold: "#f59e0b",
};

export default function DispatchPage() {
  const trpc = useTRPC();
  const data = useQuery(trpc.admin.dispatch.queryOptions(undefined, { refetchInterval: 10_000 }));
  const crews = data.data?.crews ?? [];
  const pins = crews.flatMap((crew) => [
    ...crew.stops.map((s) => ({ id: s.jobId, lat: s.lat, lng: s.lng, label: `${s.sequence}. #${s.confirmationNumber} ${s.name} (${s.status})`, color: STATUS_COLOR[s.status] ?? "#64748b" })),
    ...(crew.location ? [{ id: `crew-${crew.id}`, lat: crew.location.lat, lng: crew.location.lng, label: `${crew.name} (live)`, color: crew.color, live: true }] : []),
  ]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">Dispatch · {data.data?.date}</h1>
        <p className="text-sm text-slate-500">Today&apos;s crews, stops, and live positions. Updates every 10 seconds.</p>
      </header>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <PinMap pins={pins} fitKey={crews.map((c) => c.id).join()} className="h-[60vh] w-full rounded-xl border border-slate-200" />
        <div className="space-y-3">
          {crews.map((crew) => (
            <section key={crew.id} className="rounded-xl border border-slate-200 bg-white p-3">
              <h2 className="flex items-center gap-2 font-semibold">
                <span className="h-3 w-3 rounded-full" style={{ background: crew.color }} />
                {crew.name}
                <span className="text-xs font-normal text-slate-500">{crew.location ? "live" : "no location yet"}</span>
              </h2>
              <ol className="mt-2 space-y-1 text-sm">
                {crew.stops.map((s) => (
                  <li key={s.jobId} className="flex items-center justify-between gap-2">
                    <span className="truncate">
                      {s.sequence}. #{s.confirmationNumber} {s.name}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className={cx("rounded px-1.5 text-xs text-white")} style={{ background: STATUS_COLOR[s.status] }}>
                        {s.status.replace("_", " ")}
                      </span>
                      <a href={`/t/${s.trackingToken}`} onClick={(e) => (e.preventDefault(), window.open(`${portalUrl()}/t/${s.trackingToken}`, "_blank"))} className="text-xs text-brand underline">
                        tracking
                      </a>
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ))}
          {crews.length === 0 && <p className="text-slate-500">No crews scheduled today.</p>}
        </div>
      </div>
    </div>
  );
}

function portalUrl() {
  return process.env.NEXT_PUBLIC_PORTAL_URL ?? `${window.location.protocol}//${window.location.hostname}:4102`;
}
