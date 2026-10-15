"use client";
/** Capacity grid: school × date × window with booked/capacity; click to raise, lower, or close a window. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { cx } from "@css/ui";
import { Alert, Button, Card, Checkbox, FormField, Input, Modal, Select, errorText, formatDate } from "@css/ui/kit";
import { useTRPC } from "@css/ui/trpc";
import { PageHeader } from "../../../components/page";

const COLS = [
  { scope: "on", windowId: null, label: "Dorms (day)" },
  { scope: "off", windowId: "AM", label: "Off campus AM" },
  { scope: "off", windowId: "PM", label: "Off campus PM" },
  { scope: "both", windowId: null, label: "Any (day)" },
  { scope: "both", windowId: "AM", label: "Any AM" },
  { scope: "both", windowId: "PM", label: "Any PM" },
] as const;

export default function Capacity() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const lookups = useQuery(trpc.admin.bookings.lookups.queryOptions()).data;
  const [seasonId, setSeasonId] = useState("");
  const [schoolId, setSchoolId] = useState("");
  const [type, setType] = useState<"pickup" | "delivery">("pickup");
  const [showGenerate, setShowGenerate] = useState(false);
  useEffect(() => {
    if (lookups && !seasonId) setSeasonId(lookups.seasons[0]?.id ?? "");
    if (lookups && !schoolId) setSchoolId(lookups.schools[0]?.id ?? "");
  }, [lookups, seasonId, schoolId]);
  const grid = useQuery(trpc.admin.config.capacity.queryOptions({ seasonId, schoolId, type }, { enabled: !!seasonId && !!schoolId })).data ?? [];
  const update = useMutation(trpc.admin.config.updateDay.mutationOptions({ onSuccess: () => qc.invalidateQueries() }));
  const dates = [...new Set(grid.map((d) => d.date))];
  const cols = COLS.filter((c) => grid.some((d) => d.campusScope === c.scope && d.windowId === c.windowId));
  const totals = grid.reduce((t, d) => ({ cap: t.cap + d.capacity, res: t.res + d.reserved }), { cap: 0, res: 0 });
  return (
    <div className="space-y-4">
      <PageHeader
        title="Capacity"
        subtitle={grid.length ? `${totals.res} of ${totals.cap} spots booked (${Math.round((totals.res / Math.max(1, totals.cap)) * 100)}%)` : "Windows customers can book"}
        actions={<Button onClick={() => setShowGenerate(true)}>Add days</Button>}
      />
      <div className="flex flex-wrap gap-2">
        <Select className="w-40" value={seasonId} onChange={(e) => setSeasonId(e.target.value)}>
          {lookups?.seasons.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Select className="w-40" value={schoolId} onChange={(e) => setSchoolId(e.target.value)}>
          {lookups?.schools.map((s) => (
            <option key={s.id} value={s.id}>
              {s.shortName}
            </option>
          ))}
        </Select>
        <Select className="w-32" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
          <option value="pickup">Pickups</option>
          <option value="delivery">Deliveries</option>
        </Select>
      </div>
      <Alert>{errorText(update.error)}</Alert>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Date</th>
              {cols.map((c) => (
                <th key={c.label} className="px-3 py-2 text-center">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dates.map((date) => (
              <tr key={date} className="border-t border-slate-100">
                <td className="px-3 py-1.5 font-medium">{formatDate(date)}</td>
                {cols.map((c) => {
                  const d = grid.find((x) => x.date === date && x.campusScope === c.scope && x.windowId === c.windowId);
                  if (!d) return <td key={c.label} />;
                  const pct = d.capacity ? d.reserved / d.capacity : 1;
                  return (
                    <td key={c.label} className="px-2 py-1 text-center">
                      <div
                        className={cx(
                          "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs",
                          d.blocked ? "bg-slate-200 text-slate-500 line-through" : pct >= 1 ? "bg-red-100 text-red-800" : pct >= 0.75 ? "bg-amber-100 text-amber-800" : "bg-green-50 text-green-800",
                        )}
                      >
                        <span className="tabular-nums">
                          {d.reserved}/
                          <input
                            className="w-9 bg-transparent text-center"
                            defaultValue={d.capacity}
                            onBlur={(e) => {
                              const v = Number(e.target.value);
                              if (Number.isInteger(v) && v !== d.capacity) update.mutate({ id: d.id, capacity: v });
                            }}
                          />
                        </span>
                        <button title={d.blocked ? "Open" : "Close"} onClick={() => update.mutate({ id: d.id, blocked: !d.blocked })} className="text-slate-500 hover:text-slate-900">
                          {d.blocked ? "⊘" : "×"}
                        </button>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {dates.length === 0 && <p className="p-6 text-center text-sm text-slate-500">No windows yet. Use “Add days”.</p>}
      </div>
      {showGenerate && lookups && <Generate seasonId={seasonId} schools={lookups.schools} type={type} onClose={() => setShowGenerate(false)} />}
    </div>
  );
}

function Generate({ seasonId, schools, type, onClose }: { seasonId: string; schools: { id: string; shortName: string }[]; type: "pickup" | "delivery"; onClose: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [schoolIds, setSchoolIds] = useState<string[]>(schools.map((s) => s.id));
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [skipSunday, setSkipSunday] = useState(true);
  const [dorm, setDorm] = useState("40");
  const [am, setAm] = useState("10");
  const [pm, setPm] = useState("10");
  const gen = useMutation(trpc.admin.config.generateDays.mutationOptions({ onSuccess: () => void qc.invalidateQueries() }));
  const windows = [
    ...(Number(dorm) > 0 ? [{ campusScope: "on" as const, windowId: null, capacity: Number(dorm) }] : []),
    ...(Number(am) > 0 ? [{ campusScope: "off" as const, windowId: "AM", capacity: Number(am) }] : []),
    ...(Number(pm) > 0 ? [{ campusScope: "off" as const, windowId: "PM", capacity: Number(pm) }] : []),
  ];
  return (
    <Modal open onClose={onClose} title={`Add ${type} days`}>
      <div className="space-y-3">
        <FormField label="Schools">
          <div className="flex flex-wrap gap-3">
            {schools.map((s) => (
              <Checkbox key={s.id} checked={schoolIds.includes(s.id)} onChange={(on) => setSchoolIds(on ? [...schoolIds, s.id] : schoolIds.filter((x) => x !== s.id))} label={s.shortName} />
            ))}
          </div>
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="From">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </FormField>
          <FormField label="To">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </FormField>
        </div>
        <Checkbox checked={skipSunday} onChange={setSkipSunday} label="Skip Sundays" />
        <div className="grid grid-cols-3 gap-3">
          <FormField label="Dorms per day">
            <Input value={dorm} onChange={(e) => setDorm(e.target.value)} />
          </FormField>
          <FormField label="Off campus AM">
            <Input value={am} onChange={(e) => setAm(e.target.value)} />
          </FormField>
          <FormField label="Off campus PM">
            <Input value={pm} onChange={(e) => setPm(e.target.value)} />
          </FormField>
        </div>
        <p className="text-xs text-slate-500">Existing windows are left alone. Set 0 to skip a window.</p>
        {gen.data && <Alert tone="green">Added {gen.data.created} windows.</Alert>}
        <Alert>{errorText(gen.error)}</Alert>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button
          loading={gen.isPending}
          disabled={!from || !to || !schoolIds.length}
          onClick={() => gen.mutate({ seasonId, schoolIds, type, from, to, skipWeekdays: skipSunday ? [0] : [], windows })}
        >
          Add days
        </Button>
      </div>
    </Modal>
  );
}
