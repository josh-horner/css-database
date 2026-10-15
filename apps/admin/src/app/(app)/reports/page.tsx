"use client";
/** Reports by any time frame: pick a report, a range, a grouping; compare with last year; export CSV. */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { cx, formatCents } from "@css/ui";
import { Alert, Button, Card, Checkbox, Empty, FormField, Input, Select, download, errorText } from "@css/ui/kit";
import { useTRPC } from "@css/ui/trpc";
import { PageHeader, addDaysIso, todayIso } from "../../../components/page";
import type { Out } from "../../../components/types";

type Kind = Out["admin"]["reports"]["kinds"][number]["kind"];
type Result = Out["admin"]["reports"]["run"];

const PRESETS: { label: string; range: () => [string, string] }[] = [
  { label: "Today", range: () => [todayIso(), todayIso()] },
  { label: "Last 7 days", range: () => [addDaysIso(todayIso(), -6), todayIso()] },
  { label: "Last 14 days (pay period)", range: () => [addDaysIso(todayIso(), -13), todayIso()] },
  { label: "Last 30 days", range: () => [addDaysIso(todayIso(), -29), todayIso()] },
  { label: "This year", range: () => [`${todayIso().slice(0, 4)}-01-01`, todayIso()] },
  { label: "Pickup season (Apr 15–May 31)", range: () => [`${todayIso().slice(0, 4)}-04-15`, `${todayIso().slice(0, 4)}-05-31`] },
];

export default function Reports() {
  const trpc = useTRPC();
  const kinds = useQuery(trpc.admin.reports.kinds.queryOptions()).data;
  const lookups = useQuery(trpc.admin.bookings.lookups.queryOptions()).data;
  const [kind, setKind] = useState<Kind>("signups");
  const [groupBy, setGroupBy] = useState("day");
  const [[from, to], setRange] = useState<[string, string]>(PRESETS[3]!.range());
  const [schoolId, setSchoolId] = useState("");
  const [compare, setCompare] = useState(false);
  const def = kinds?.find((k) => k.kind === kind);
  useEffect(() => {
    if (def && !def.groups.includes(groupBy)) setGroupBy(def.groups[0]!);
  }, [def, groupBy]);
  const report = useQuery(trpc.admin.reports.run.queryOptions({ kind, from, to, groupBy, schoolId: schoolId || null, compareLastYear: compare }, { enabled: !!def?.groups.includes(groupBy) }));

  return (
    <div className="space-y-4">
      <PageHeader title="Reports" subtitle="Any report for any time frame. Dashboards are just saved reports (coming next)." />
      <Card>
        <div className="grid gap-3 md:grid-cols-6">
          <FormField label="Report" className="md:col-span-2">
            <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              {kinds?.map((k) => (
                <option key={k.kind} value={k.kind}>
                  {k.label}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Group by">
            <Select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
              {def?.groups.map((g) => (
                <option key={g} value={g}>
                  {g.replace("_", " ")}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="From">
            <Input type="date" value={from} onChange={(e) => setRange([e.target.value, to])} />
          </FormField>
          <FormField label="To">
            <Input type="date" value={to} onChange={(e) => setRange([from, e.target.value])} />
          </FormField>
          <FormField label="School">
            <Select value={schoolId} onChange={(e) => setSchoolId(e.target.value)}>
              <option value="">All</option>
              {lookups?.schools.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.shortName}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {PRESETS.map((p) => (
            <button key={p.label} onClick={() => setRange(p.range())} className="rounded-full border border-slate-300 px-2.5 py-0.5 text-xs hover:bg-slate-50">
              {p.label}
            </button>
          ))}
          <span className="ml-auto">
            <Checkbox checked={compare} onChange={setCompare} label="Compare with last year" />
          </span>
        </div>
      </Card>
      <Alert>{errorText(report.error)}</Alert>
      {report.data && <ReportTable r={report.data} />}
    </div>
  );
}

function fmt(type: string, v: unknown) {
  if (v === null || v === undefined) return "—";
  if (type === "money") return formatCents(Number(v));
  if (type === "percent") return `${Math.round(Number(v) * 100)}%`;
  if (type === "minutes") return `${v} min`;
  return typeof v === "number" ? v.toLocaleString() : String(v);
}

function ReportTable({ r }: { r: Result }) {
  const metric = r.columns.find((c) => c.type !== "text");
  const max = Math.max(1, ...r.rows.map((row) => Number(row[metric?.key ?? ""] ?? 0)));
  const csv = () =>
    download(
      `css-${r.kind}.csv`,
      [r.columns.map((c) => c.label).join(","), ...r.rows.map((row) => r.columns.map((c) => JSON.stringify(row[c.key] ?? "")).join(","))].join("\n"),
    );
  return (
    <Card title={r.title} actions={<Button size="sm" variant="secondary" onClick={csv}>Export CSV</Button>}>
      {r.compare && <p className="mb-2 text-xs text-slate-500">Compared with {r.compare.from} – {r.compare.to}</p>}
      {r.rows.length === 0 ? (
        <Empty>Nothing in this range.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr>
                {r.columns.map((c) => (
                  <th key={c.key} className={cx("py-1 pr-3", c.type !== "text" && "text-right")}>
                    {c.label}
                  </th>
                ))}
                <th className="w-1/4" />
              </tr>
            </thead>
            <tbody>
              {r.rows.map((row, i) => (
                <tr key={i} className="border-t border-slate-100">
                  {r.columns.map((c) => (
                    <td key={c.key} className={cx("py-1.5 pr-3", c.type !== "text" && "text-right tabular-nums")}>
                      {fmt(c.type, row[c.key])}
                    </td>
                  ))}
                  <td>
                    {metric && (
                      <div className="h-2 rounded bg-slate-100">
                        <div className="h-2 rounded bg-brand/70" style={{ width: `${(Number(row[metric.key] ?? 0) / max) * 100}%` }} />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-200 font-semibold">
                {r.columns.map((c, i) => (
                  <td key={c.key} className={cx("py-1.5 pr-3", c.type !== "text" && "text-right tabular-nums")}>
                    {i === 0 ? "Total" : fmt(c.type, r.totals[c.key])}
                  </td>
                ))}
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
