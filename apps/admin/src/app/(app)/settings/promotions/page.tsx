"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { formatCents, parseDollars } from "@css/ui";
import { Alert, Badge, Button, Card, Checkbox, Empty, FormField, Input, Modal, errorText } from "@css/ui/kit";
import { useTRPC } from "@css/ui/trpc";
import { PageHeader } from "../../../../components/page";
import type { Out } from "../../../../components/types";

type Promo = Out["admin"]["config"]["promotions"][number];

export default function Promotions() {
  const trpc = useTRPC();
  const promos = useQuery(trpc.admin.config.promotions.queryOptions()).data;
  const settings = useQuery(trpc.admin.config.settings.queryOptions()).data;
  const [edit, setEdit] = useState<Partial<Promo> | null>(null);
  return (
    <div className="space-y-4">
      <PageHeader title="Promotions" subtitle="Named discount codes (instead of freehand discounts), so they show up in reports." actions={<Button onClick={() => setEdit({ active: true })}>New code</Button>} />
      {settings && (
        <Alert tone="blue">
          Referrals are automatic: every booking has a personal link. Parent referrals give both sides {formatCents(settings.referralParentRewardCents)}; student referrals give the new customer{" "}
          {formatCents(settings.referralStudentRefereeCents)} off and the referrer a {formatCents(settings.referralStudentReferrerCents)} payout. Change these in Settings.
        </Alert>
      )}
      <Card>
        {promos?.length === 0 && <Empty>No promotion codes yet.</Empty>}
        <ul className="divide-y divide-slate-100">
          {promos?.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span>
                <code className="font-semibold">{p.code}</code> · {p.description} · {formatCents(p.amountCents)} off · used {p.uses}
                {p.maxUses ? `/${p.maxUses}` : ""} {!p.active && <Badge>off</Badge>}
              </span>
              <Button size="sm" variant="ghost" onClick={() => setEdit(p)}>
                Edit
              </Button>
            </li>
          ))}
        </ul>
      </Card>
      {edit && <PromoModal p={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function PromoModal({ p, onClose }: { p: Partial<Promo>; onClose: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [v, setV] = useState({ code: p.code ?? "", description: p.description ?? "", amount: p.amountCents ? (p.amountCents / 100).toFixed(2) : "", maxUses: p.maxUses ? String(p.maxUses) : "", validUntil: p.validUntil ? new Date(p.validUntil).toISOString().slice(0, 10) : "", active: p.active ?? true });
  const save = useMutation(trpc.admin.config.savePromotion.mutationOptions({ onSuccess: () => (void qc.invalidateQueries(), onClose()) }));
  return (
    <Modal open onClose={onClose} title={p.id ? `Edit ${p.code}` : "New promotion code"}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Code">
          <Input value={v.code} onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })} />
        </FormField>
        <FormField label="Amount off">
          <Input value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />
        </FormField>
        <FormField label="Description" className="sm:col-span-2">
          <Input value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
        </FormField>
        <FormField label="Max uses (optional)">
          <Input value={v.maxUses} onChange={(e) => setV({ ...v, maxUses: e.target.value })} />
        </FormField>
        <FormField label="Valid until (optional)">
          <Input type="date" value={v.validUntil} onChange={(e) => setV({ ...v, validUntil: e.target.value })} />
        </FormField>
        <Checkbox checked={v.active} onChange={(c) => setV({ ...v, active: c })} label="Active" />
      </div>
      <Alert>{errorText(save.error)}</Alert>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          loading={save.isPending}
          disabled={!v.code || !parseDollars(v.amount)}
          onClick={() =>
            save.mutate({
              id: p.id ?? null,
              code: v.code,
              description: v.description,
              amountCents: parseDollars(v.amount)!,
              seasonId: null,
              validUntil: v.validUntil ? new Date(`${v.validUntil}T23:59:59`) : null,
              maxUses: v.maxUses ? Number(v.maxUses) : null,
              active: v.active,
            })
          }
        >
          Save
        </Button>
      </div>
    </Modal>
  );
}
