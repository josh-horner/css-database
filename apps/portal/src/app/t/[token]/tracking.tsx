"use client";
/**
 * Day-of tracking, like following a package: queue position, ETA, and the crew on the map once they're
 * heading to you. A plain page that refreshes every minute; no app (ADR-0005).
 */
import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useTRPC } from "@css/ui/trpc";

const PinMap = dynamic(() => import("@css/ui/map").then((m) => m.PinMap), { ssr: false });

export function Tracking({ token }: { token: string }) {
  const trpc = useTRPC();
  const q = useQuery(trpc.portal.tracking.queryOptions({ token }, { refetchInterval: 60_000, refetchIntervalInBackground: false }));

  if (q.isError) return <Shell><p className="text-slate-600">This tracking link isn&apos;t valid anymore.</p></Shell>;
  if (!q.data) return <Shell><p className="text-slate-500">Loading…</p></Shell>;
  const t = q.data;
  const queue = t.queue;
  const done = queue?.status === "completed";
  const here = queue?.status === "arrived";

  const pins = [
    { id: "home", lat: t.destination.lat, lng: t.destination.lng, label: "You", color: "#0f172a" },
    ...(t.crewLocation && t.crew ? [{ id: "crew", lat: t.crewLocation.lat, lng: t.crewLocation.lng, label: t.crew.name, color: t.crew.color, live: true }] : []),
  ];

  return (
    <Shell>
      <p className="text-sm text-slate-500">
        #{t.confirmationNumber} · {t.type} · {t.window}
      </p>
      <h1 className="mt-1 text-2xl font-semibold leading-tight">
        {done ? "All done. Thanks, " : here ? "Your crew is here, " : queue?.crewHeadingHere ? "Your crew is on the way, " : "Hi "}
        {t.firstName}!
      </h1>

      {done && (
        <a href={`/r/${token}`} className="mt-4 block rounded-xl bg-brand p-4 text-center font-semibold text-white">
          Rate your crew (and tip them if you'd like)
        </a>
      )}

      {queue && !done && (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Stat label="Arriving around" value={here ? "Now" : queue.etaLabel} sub={here ? "" : `about ${queue.etaMinutes} min`} />
          <Stat label="Your place in line" value={`${queue.position} of ${queue.totalStops}`} sub={queue.stopsAhead ? `${queue.stopsAhead} stop${queue.stopsAhead === 1 ? "" : "s"} ahead` : "You're next"} />
        </div>
      )}

      {t.crewLocation ? (
        <PinMap pins={pins} className="mt-4 h-72 w-full rounded-xl border border-slate-200" />
      ) : (
        !done && <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">The map shows your crew live once they&apos;re heading to you.</p>
      )}

      <dl className="mt-4 space-y-1 text-sm">
        <div className="flex justify-between gap-4"><dt className="text-slate-500">Where</dt><dd className="text-right">{t.address}{t.room ? `, room ${t.room}` : ""}</dd></div>
        {t.crew && <div className="flex justify-between gap-4"><dt className="text-slate-500">Crew</dt><dd className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: t.crew.color }} />{t.crew.name}</dd></div>}
      </dl>

      {!done && (
        <ul className="mt-6 list-disc space-y-1 pl-5 text-sm text-slate-600">
          <li>Have everything packed, closed, and labeled with #{t.confirmationNumber}.</li>
          <li>This page updates by itself every minute.</li>
        </ul>
      )}
      <p className="mt-6 text-xs text-slate-400">Updated {new Date(t.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-full max-w-md px-4 py-6">
      <div className="mb-4 text-sm font-semibold tracking-wide text-brand">COLLEGE STUDENT STORAGE</div>
      {children}
    </main>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-slate-500">{sub}</div>
    </div>
  );
}
