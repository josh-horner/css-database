"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { formatCents, parseDollars } from "@css/ui";
import { Alert, Button, Card, FormField, Input, Modal, Select, errorText, formatDate } from "@css/ui/kit";
import { useTRPC } from "@css/ui/trpc";
import { PageHeader } from "../../../../components/page";
import type { Out } from "../../../../components/types";

type Season = Out["admin"]["config"]["seasons"][number];

export default function Seasons() {
  const trpc = useTRPC();
  const seasons = useQuery(trpc.admin.config.seasons.queryOptions()).data;
  const [edit, setEdit] = useState<Partial<Season> | null>(null);
  return (
    <div className="space-y-4">
      <PageHeader title="Seasons" subtitle="Bookings, rate cards, and capacity are scoped to a season." actions={<Button onClick={() => setEdit({ kind: "summer", depositCents: 5900, cardFeeBps: 300, leadDays: 2 })}>New season</Button>} />
      <Card>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="py-1">Season</th>
              <th className="py-1">Dates</th>
              <th className="py-1 text-right">Deposit</th>
              <th className="py-1 text-right">Card fee</th>
              <th className="py-1 text-right">Lead time</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {seasons?.map((s) => (
              <tr key={s.id} className="border-t border-slate-100">
                <td className="py-1.5 font-medium">{s.name}</td>
                <td className="py-1.5">
                  {formatDate(s.startsOn)} – {formatDate(s.endsOn)}
                </td>
                <td className="py-1.5 text-right">{formatCents(s.depositCents)}</td>
                <td className="py-1.5 text-right">{s.cardFeeBps / 100}%</td>
                <td className="py-1.5 text-right">{s.leadDays} days</td>
                <td className="py-1.5 text-right">
                  <Button size="sm" variant="ghost" onClick={() => setEdit(s)}>
                    Edit
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {edit && <SeasonModal s={edit} seasons={seasons ?? []} onClose={() => setEdit(null)} />}
    </div>
  );
}

function SeasonModal({ s, seasons, onClose }: { s: Partial<Season>; seasons: Season[]; onClose: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [v, setV] = useState({
    name: s.name ?? "",
    kind: s.kind ?? "summer",
    startsOn: s.startsOn ?? "",
    endsOn: s.endsOn ?? "",
    deposit: ((s.depositCents ?? 5900) / 100).toFixed(2),
    fee: String((s.cardFeeBps ?? 300) / 100),
    leadDays: String(s.leadDays ?? 2),
    copyFrom: s.id ? "" : (seasons[0]?.id ?? ""),
  });
  const save = useMutation(trpc.admin.config.saveSeason.mutationOptions({ onSuccess: () => (void qc.invalidateQueries(), onClose()) }));
  return (
    <Modal open onClose={onClose} title={s.id ? `Edit ${s.name}` : "New season"}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Name">
          <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Summer 2028" />
        </FormField>
        <FormField label="Kind">
          <Select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as typeof v.kind })}>
            <option value="summer">Summer</option>
            <option value="semester">Semester</option>
            <option value="year_round">Year-round</option>
          </Select>
        </FormField>
        <FormField label="Starts">
          <Input type="date" value={v.startsOn} onChange={(e) => setV({ ...v, startsOn: e.target.value })} />
        </FormField>
        <FormField label="Ends">
          <Input type="date" value={v.endsOn} onChange={(e) => setV({ ...v, endsOn: e.target.value })} />
        </FormField>
        <FormField label="Sign-up deposit">
          <Input value={v.deposit} onChange={(e) => setV({ ...v, deposit: e.target.value })} />
        </FormField>
        <FormField label="Card fee %">
          <Input value={v.fee} onChange={(e) => setV({ ...v, fee: e.target.value })} />
        </FormField>
        <FormField label="Booking lead time (days)">
          <Input value={v.leadDays} onChange={(e) => setV({ ...v, leadDays: e.target.value })} />
        </FormField>
        {!s.id && (
          <FormField label="Copy rate card from">
            <Select value={v.copyFrom} onChange={(e) => setV({ ...v, copyFrom: e.target.value })}>
              <option value="">Start empty</option>
              {seasons.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </FormField>
        )}
      </div>
      <Alert>{errorText(save.error)}</Alert>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          loading={save.isPending}
          onClick={() =>
            save.mutate({
              id: s.id ?? null,
              name: v.name,
              kind: v.kind,
              startsOn: v.startsOn,
              endsOn: v.endsOn,
              depositCents: parseDollars(v.deposit) ?? 0,
              cardFeeBps: Math.round(Number(v.fee) * 100),
              leadDays: Number(v.leadDays),
              copyRateCardFrom: v.copyFrom || null,
            })
          }
        >
          Save
        </Button>
      </div>
    </Modal>
  );
}
