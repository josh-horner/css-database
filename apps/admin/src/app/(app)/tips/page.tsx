"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { formatCents } from "@css/ui";
import { Alert, Button, Card, Empty, Input, download, errorText, formatDateTime } from "@css/ui/kit";
import { useTRPC } from "@css/ui/trpc";
import { PageHeader, addDaysIso, todayIso } from "../../../components/page";

export default function Tips() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [from, setFrom] = useState(addDaysIso(todayIso(), -13));
  const [to, setTo] = useState(todayIso());
  const data = useQuery(trpc.admin.tips.period.queryOptions({ from, to })).data;
  const paid = useMutation(trpc.admin.tips.markPaid.mutationOptions({ onSuccess: () => qc.invalidateQueries() }));
  const exportCsv = () =>
    download(`css-tips-${from}-${to}.csv`, ["employee,tips,total,unpaid", ...(data?.employees ?? []).map((e) => `${e.name},${e.tips},${(e.totalCents / 100).toFixed(2)},${(e.unpaidCents / 100).toFixed(2)}`)].join("\n"));
  return (
    <div className="space-y-4">
      <PageHeader
        title="Tips"
        subtitle="Tips belong to the crew, not CSS: they never touch a booking's bill. Pay them out through payroll."
        actions={
          <>
            <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
            <Button variant="secondary" onClick={exportCsv}>
              Payroll CSV
            </Button>
            <Button onClick={() => paid.mutate({ from, to })} loading={paid.isPending}>
              Mark paid out
            </Button>
          </>
        }
      />
      <Alert>{errorText(paid.error)}</Alert>
      {paid.data && <Alert tone="green">Marked {paid.data.count} tip(s) paid.</Alert>}
      <Card title="By employee">
        {data?.employees.length === 0 ? (
          <Empty>No tips in this period.</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="py-1">Employee</th>
                <th className="py-1 text-right">Tips</th>
                <th className="py-1 text-right">Total</th>
                <th className="py-1 text-right">Not paid out</th>
              </tr>
            </thead>
            <tbody>
              {data?.employees.map((e) => (
                <tr key={e.employeeId} className="border-t border-slate-100">
                  <td className="py-1.5">{e.name}</td>
                  <td className="py-1.5 text-right">{e.tips}</td>
                  <td className="py-1.5 text-right">{formatCents(e.totalCents)}</td>
                  <td className="py-1.5 text-right font-medium">{formatCents(e.unpaidCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card title="Recent tips">
        <ul className="divide-y divide-slate-100 text-sm">
          {data?.tips.map((t) => (
            <li key={t.id} className="flex justify-between py-1.5">
              <span>
                {formatDateTime(t.at)} · {t.crew}
              </span>
              <span>
                {formatCents(t.totalCents)} {t.paidOut && <span className="text-xs text-green-700">paid out</span>}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
