"use client";
/** Build a day's crews (copy yesterday, move people), assign and order stops, assign tablets, publish (texts each employee). */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { cx } from "@css/ui";
import { Alert, Badge, Button, Card, Checkbox, Empty, Input, Select, errorText, formatDate } from "@css/ui/kit";
import { useTRPC } from "@css/ui/trpc";
import { PageHeader, addDaysIso, human, todayIso } from "../../../components/page";
import type { Out } from "../../../components/types";

type Day = Out["admin"]["crews"]["day"];
type Job = Day["unassigned"][number];

export default function Crews() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [date, setDate] = useState(todayIso());
  const day = useQuery(trpc.admin.crews.day.queryOptions({ date }));
  const done = { onSuccess: () => void qc.invalidateQueries() };
  const create = useMutation(trpc.admin.crews.create.mutationOptions(done));
  const copy = useMutation(trpc.admin.crews.copy.mutationOptions(done));
  const publish = useMutation(trpc.admin.crews.publish.mutationOptions(done));
  const assign = useMutation(trpc.admin.crews.assign.mutationOptions(done));
  const [selected, setSelected] = useState<string[]>([]);
  const d = day.data;
  const error = create.error ?? copy.error ?? publish.error ?? assign.error;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Crews"
        subtitle={d ? `${formatDate(date, { weekday: "long", month: "long", day: "numeric" })} · ${d.crews.reduce((n, c) => n + c.jobs.length, 0)} assigned · ${d.unassigned.length} unassigned` : undefined}
        actions={
          <>
            <Button variant="secondary" onClick={() => setDate(addDaysIso(date, -1))}>
              ←
            </Button>
            <Input type="date" className="w-40" value={date} onChange={(e) => setDate(e.target.value)} />
            <Button variant="secondary" onClick={() => setDate(addDaysIso(date, 1))}>
              →
            </Button>
            {d?.crews.length === 0 && (
              <Button variant="secondary" onClick={() => copy.mutate({ from: addDaysIso(date, -1), to: date })} loading={copy.isPending}>
                Copy yesterday's crews
              </Button>
            )}
            <Button variant="secondary" onClick={() => create.mutate({ date })} loading={create.isPending}>
              New crew
            </Button>
            <Button onClick={() => publish.mutate({ date })} loading={publish.isPending} disabled={!d?.crews.length}>
              Publish & text crews
            </Button>
          </>
        }
      />
      <Alert>{errorText(error)}</Alert>
      {publish.data && <Alert tone="green">Texted {publish.data.texts} employees their assignments.</Alert>}
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="grid gap-4 lg:grid-cols-2">
          {d?.crews.map((c) => <CrewCard key={c.id} crew={c} day={d} />)}
          {d?.crews.length === 0 && <Empty>No crews this day yet.</Empty>}
        </div>
        <Card
          title={`Unassigned (${d?.unassigned.length ?? 0})`}
          actions={
            selected.length > 0 && (
              <Select
                className="w-40 py-1 text-xs"
                value=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  const crew = d!.crews.find((c) => c.id === e.target.value)!;
                  assign.mutate({ crewId: crew.id, jobIds: [...crew.jobs.map((j) => j.jobId), ...selected] });
                  setSelected([]);
                }}
              >
                <option value="">Assign {selected.length} to…</option>
                {d?.crews.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )
          }
        >
          <ul className="max-h-[70vh] space-y-1 overflow-y-auto">
            {d?.unassigned.map((j) => (
              <li key={j.jobId} className="flex items-start gap-2 rounded-md p-1 hover:bg-slate-50">
                <Checkbox checked={selected.includes(j.jobId)} onChange={(on) => setSelected(on ? [...selected, j.jobId] : selected.filter((x) => x !== j.jobId))} label="" />
                <JobLine j={j} />
              </li>
            ))}
          </ul>
          {d?.unassigned.length === 0 && <p className="text-sm text-slate-500">Every stop is on a crew.</p>}
        </Card>
      </div>
    </div>
  );
}

function JobLine({ j }: { j: Job }) {
  return (
    <div className="min-w-0 text-sm">
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: j.schoolColor ?? "#94a3b8" }} />
        <Link href={`/bookings/${j.bookingId}`} className="truncate font-medium hover:underline">
          #{j.confirmationNumber} {j.name}
        </Link>
        <Badge tone={j.type === "delivery" ? "amber" : "blue"}>{j.type}</Badge>
        {j.onHold && <Badge tone="red">on hold: past due</Badge>}
      </div>
      <div className="truncate text-xs text-slate-500">
        {j.windowId ?? "day"} · {j.residence ?? j.address} {j.room && `· ${j.room}`} · {human(j.status)}
      </div>
    </div>
  );
}

function CrewCard({ crew, day }: { crew: Day["crews"][number]; day: Day }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const done = { onSuccess: () => void qc.invalidateQueries() };
  const setMember = useMutation(trpc.admin.crews.setMember.mutationOptions(done));
  const assign = useMutation(trpc.admin.crews.assign.mutationOptions(done));
  const auto = useMutation(trpc.admin.crews.autoOrder.mutationOptions(done));
  const device = useMutation(trpc.admin.crews.assignDevice.mutationOptions(done));
  const update = useMutation(trpc.admin.crews.update.mutationOptions(done));
  const ids = crew.jobs.map((j) => j.jobId);
  const move = (i: number, dir: -1 | 1) => {
    const next = [...ids];
    const [x] = next.splice(i, 1);
    next.splice(i + dir, 0, x!);
    assign.mutate({ crewId: crew.id, jobIds: next });
  };
  const error = setMember.error ?? assign.error ?? auto.error ?? device.error ?? update.error;
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full" style={{ background: crew.color }} />
          <input className="w-28 rounded border border-transparent px-1 font-semibold hover:border-slate-300" defaultValue={crew.name} onBlur={(e) => e.target.value !== crew.name && update.mutate({ crewId: crew.id, name: e.target.value })} />
          {crew.publishedAt && <Badge tone="green">published</Badge>}
        </span>
      }
      actions={
        <Button size="sm" variant="ghost" onClick={() => auto.mutate({ crewId: crew.id })} loading={auto.isPending} disabled={crew.jobs.length < 2}>
          Auto-order
        </Button>
      }
    >
      <Alert>{errorText(error)}</Alert>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <input
          className="rounded-md border border-slate-300 px-2 py-1"
          placeholder="Vehicle"
          defaultValue={crew.vehicle ?? ""}
          onBlur={(e) => e.target.value !== (crew.vehicle ?? "") && update.mutate({ crewId: crew.id, vehicle: e.target.value || null })}
        />
        <Select className="py-1" value={crew.device?.id ?? ""} onChange={(e) => (e.target.value ? device.mutate({ deviceId: e.target.value, crewId: crew.id }) : crew.device && device.mutate({ deviceId: crew.device.id, crewId: null }))}>
          <option value="">No tablet</option>
          {day.devices.map((dv) => (
            <option key={dv.id} value={dv.id}>
              {dv.name}
              {dv.assignedCrewId && dv.assignedCrewId !== crew.id ? " (on another crew)" : ""}
            </option>
          ))}
        </Select>
      </div>
      <ul className="mt-3 space-y-1">
        {crew.members.map((m) => (
          <li key={m.employeeId} className="flex items-center gap-2 text-sm">
            <span className="flex-1">{m.name}</span>
            <Select className="w-28 py-0.5 text-xs" value={m.role} onChange={(e) => setMember.mutate({ crewId: crew.id, employeeId: m.employeeId, role: e.target.value })}>
              {[...new Set([...day.roles, m.role])].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </Select>
            <button className="text-slate-400 hover:text-red-600" onClick={() => setMember.mutate({ crewId: crew.id, employeeId: m.employeeId, role: null })} title="Remove">
              ✕
            </button>
          </li>
        ))}
      </ul>
      <Select
        className="mt-2 py-1 text-xs"
        value=""
        onChange={(e) => {
          const emp = day.available.find((x) => x.id === e.target.value);
          if (emp) setMember.mutate({ crewId: crew.id, employeeId: emp.id, role: emp.defaultRoles[0] ?? day.roles[0] ?? "mover" });
        }}
      >
        <option value="">+ Add person…</option>
        {day.available.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name} ({e.defaultRoles.join(", ")})
          </option>
        ))}
        {day.crews
          .filter((c) => c.id !== crew.id)
          .flatMap((c) => c.members.map((m) => ({ ...m, crew: c.name })))
          .map((m) => (
            <option key={m.employeeId} value="" disabled>
              {m.name} (on {m.crew})
            </option>
          ))}
      </Select>
      <ol className="mt-3 space-y-1 border-t border-slate-100 pt-2">
        {crew.jobs.map((j, i) => (
          <li key={j.jobId} className={cx("flex items-start gap-2 rounded-md p-1", j.status === "completed" && "opacity-50")}>
            <span className="w-5 pt-0.5 text-right text-xs font-semibold text-slate-500">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <JobLine j={j} />
            </div>
            <div className="flex shrink-0 flex-col text-xs text-slate-400">
              <button disabled={i === 0} onClick={() => move(i, -1)} className="hover:text-slate-800 disabled:opacity-30">
                ▲
              </button>
              <button disabled={i === crew.jobs.length - 1} onClick={() => move(i, 1)} className="hover:text-slate-800 disabled:opacity-30">
                ▼
              </button>
            </div>
            <button className="text-xs text-slate-400 hover:text-red-600" onClick={() => assign.mutate({ crewId: null, jobIds: [j.jobId] })} title="Unassign">
              ✕
            </button>
          </li>
        ))}
        {crew.jobs.length === 0 && <li className="text-sm text-slate-500">No stops yet: pick some from Unassigned.</li>}
      </ol>
    </Card>
  );
}
