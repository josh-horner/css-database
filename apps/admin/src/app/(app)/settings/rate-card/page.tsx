"use client";
/** Rate card per season: prices are the owner's call. Hand-priced lines that keep recurring show up as suggestions. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { cx, formatCents, parseDollars } from "@css/ui";
import { Alert, Badge, Button, Card, Checkbox, FormField, Input, Modal, Select, errorText } from "@css/ui/kit";
import { useTRPC } from "@css/ui/trpc";
import { PageHeader } from "../../../../components/page";
import type { Out } from "../../../../components/types";

type Item = Out["admin"]["config"]["rateCard"]["items"][number];

export default function RateCard() {
  const trpc = useTRPC();
  const seasons = useQuery(trpc.admin.config.seasons.queryOptions()).data;
  const [seasonId, setSeasonId] = useState("");
  useEffect(() => {
    if (seasons && !seasonId) setSeasonId(seasons[0]?.id ?? "");
  }, [seasons, seasonId]);
  const data = useQuery(trpc.admin.config.rateCard.queryOptions({ seasonId }, { enabled: !!seasonId })).data;
  const [edit, setEdit] = useState<Partial<Item> | null>(null);
  const [q, setQ] = useState("");
  const items = (data?.items ?? []).filter((i) => !q || `${i.name} ${i.code} ${i.category}`.toLowerCase().includes(q.toLowerCase()));
  const categories = [...new Set(items.map((i) => i.category))];
  return (
    <div className="space-y-4">
      <PageHeader
        title="Rate card"
        subtitle="What the crew picks on the digital contract and what invoices charge. Edit any time; issued invoices keep their prices."
        actions={
          <>
            <Select className="w-40" value={seasonId} onChange={(e) => setSeasonId(e.target.value)}>
              {seasons?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <Button onClick={() => setEdit({ seasonId, unit: "each", onContract: true, active: true, category: "" })}>Add item</Button>
          </>
        }
      />
      {data && data.suggestions.length > 0 && (
        <Card title="Suggestions: priced by hand more than once">
          <ul className="space-y-1 text-sm">
            {data.suggestions.map((s) => (
              <li key={s.description} className="flex items-center justify-between gap-2">
                <span>
                  <strong>{s.description}</strong> · {s.times}× · usually {formatCents(s.typical_cents)}
                  {s.min_cents !== s.max_cents && ` (${formatCents(s.min_cents)}–${formatCents(s.max_cents)})`}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setEdit({ seasonId, name: s.description.replace(/^\w/, (c) => c.toUpperCase()), unitPriceCents: s.typical_cents, unit: "each", onContract: true, active: true, category: "other" })}
                >
                  Add to rate card
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
      <div className="grid gap-4 lg:grid-cols-2">
        {categories.map((cat) => (
          <Card key={cat} title={cat}>
            <table className="w-full text-sm">
              <tbody>
                {items
                  .filter((i) => i.category === cat)
                  .map((i) => (
                    <tr key={i.id} className={cx("border-t border-slate-100", !i.active && "text-slate-400")}>
                      <td className="py-1.5">
                        {i.name} {!i.onContract && <Badge className="ml-1">not on crew list</Badge>} {!i.active && <Badge className="ml-1">off</Badge>}
                        <div className="text-xs text-slate-400">{i.code}</div>
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {formatCents(i.unitPriceCents)}
                        <span className="text-xs text-slate-500">/{i.unit}</span>
                      </td>
                      <td className="w-14 py-1.5 text-right">
                        <Button size="sm" variant="ghost" onClick={() => setEdit(i)}>
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </Card>
        ))}
      </div>
      {edit && <ItemModal item={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function ItemModal({ item, onClose }: { item: Partial<Item>; onClose: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [v, setV] = useState({
    name: item.name ?? "",
    code: item.code ?? "",
    category: item.category ?? "",
    unit: item.unit ?? "each",
    price: item.unitPriceCents !== undefined ? (item.unitPriceCents / 100).toFixed(2) : "",
    onContract: item.onContract ?? true,
    active: item.active ?? true,
  });
  const save = useMutation(trpc.admin.config.saveRateCardItem.mutationOptions({ onSuccess: () => (void qc.invalidateQueries(), onClose()) }));
  const cents = parseDollars(v.price);
  return (
    <Modal open onClose={onClose} title={item.id ? `Edit ${item.name}` : "Add rate card item"}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Name" className="sm:col-span-2">
          <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value, code: item.id ? v.code : e.target.value.toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 30) })} />
        </FormField>
        <FormField label="Category">
          <Input value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })} placeholder="boxes, furniture…" />
        </FormField>
        <FormField label="Code">
          <Input value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} />
        </FormField>
        <FormField label="Price">
          <Input value={v.price} onChange={(e) => setV({ ...v, price: e.target.value })} />
        </FormField>
        <FormField label="Per">
          <Select value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value as typeof v.unit })}>
            <option value="each">each</option>
            <option value="hour">hour</option>
            <option value="minute">minute</option>
            <option value="flat">flat</option>
          </Select>
        </FormField>
        <div className="space-y-2 sm:col-span-2">
          <Checkbox checked={v.onContract} onChange={(c) => setV({ ...v, onContract: c })} label="Crew can pick it on the digital contract" />
          <Checkbox checked={v.active} onChange={(c) => setV({ ...v, active: c })} label="Active" />
        </div>
      </div>
      <Alert>{errorText(save.error)}</Alert>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          loading={save.isPending}
          disabled={!v.name || !v.category || cents === null}
          onClick={() => save.mutate({ id: item.id ?? null, seasonId: item.seasonId!, code: v.code, name: v.name, category: v.category, unit: v.unit, unitPriceCents: cents!, onContract: v.onContract, active: v.active })}
        >
          Save
        </Button>
      </div>
    </Modal>
  );
}
