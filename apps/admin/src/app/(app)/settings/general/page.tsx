"use client";
/** Owner settings: tips, claims, reminders, referral rewards, AI autonomy, crew roles. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { formatCents, parseDollars } from "@css/ui";
import { Alert, Button, Card, Checkbox, FormField, Input, Textarea, errorText } from "@css/ui/kit";
import { useTRPC } from "@css/ui/trpc";
import { PageHeader } from "../../../../components/page";
import type { Out } from "../../../../components/types";

type S = Out["admin"]["config"]["settings"];
const INTENTS: [string, string][] = [
  ["where_when", "Where are you / when are you coming"],
  ["packing_supplies", "Packing and supplies"],
  ["pricing", "Prices (from the rate card)"],
  ["billing", "Billing questions"],
  ["schedule_change", "Schedule changes (links to self-service)"],
  ["other", "Other general questions"],
];

export default function General() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const s = useQuery(trpc.admin.config.settings.queryOptions()).data;
  const [v, setV] = useState<S | null>(null);
  useEffect(() => {
    if (s && !v) setV(s);
  }, [s, v]);
  const save = useMutation(trpc.admin.config.saveSettings.mutationOptions({ onSuccess: (r) => (setV(r), void qc.invalidateQueries()) }));
  if (!v) return <p className="text-slate-500">Loading…</p>;
  const money = (key: keyof S) => (
    <Input
      defaultValue={((v[key] as number) / 100).toFixed(2)}
      onBlur={(e) => {
        const c = parseDollars(e.target.value);
        if (c !== null) setV({ ...v, [key]: c });
      }}
    />
  );
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title="Settings" actions={<Button onClick={() => save.mutate(v)} loading={save.isPending}>Save settings</Button>} />
      <Alert>{errorText(save.error)}</Alert>
      {save.isSuccess && <Alert tone="green">Saved.</Alert>}
      <Card title="Assistant (customer texts)">
        <p className="mb-2 text-sm text-slate-600">The assistant drafts a reply to every message. For these topics it sends the reply itself when it's confident; everything else waits for you.</p>
        <div className="space-y-1.5">
          {INTENTS.map(([id, label]) => (
            <Checkbox key={id} checked={v.aiAutoSendIntents.includes(id)} onChange={(on) => setV({ ...v, aiAutoSendIntents: on ? [...v.aiAutoSendIntents, id] : v.aiAutoSendIntents.filter((x) => x !== id) })} label={label} />
          ))}
        </div>
        <FormField label="Minimum confidence to send on its own" className="mt-3 max-w-xs" help={`${Math.round(v.aiAutoSendMinConfidence * 100)}%`}>
          <input type="range" min={0.5} max={0.99} step={0.01} value={v.aiAutoSendMinConfidence} onChange={(e) => setV({ ...v, aiAutoSendMinConfidence: Number(e.target.value) })} className="w-full" />
        </FormField>
      </Card>
      <Card title="Signup follow-up">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Early steps: idle hours before reminder">
            <Input type="number" value={v.abandonAfterHoursEarly} onChange={(e) => setV({ ...v, abandonAfterHoursEarly: Number(e.target.value) })} />
          </FormField>
          <FormField label="People step and later: idle hours">
            <Input type="number" value={v.abandonAfterHoursLate} onChange={(e) => setV({ ...v, abandonAfterHoursLate: Number(e.target.value) })} />
          </FormField>
        </div>
        <div className="mt-2">
          <Checkbox checked={v.abandonmentEmail} onChange={(c) => setV({ ...v, abandonmentEmail: c })} label="Send one “finish your signup” reminder" help="Texts only go to people who checked “CSS can text me if I get stuck”." />
        </div>
      </Card>
      <Card title="Referral rewards">
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label="Parent referral (each side)">{money("referralParentRewardCents")}</FormField>
          <FormField label="Student referral: new customer">{money("referralStudentRefereeCents")}</FormField>
          <FormField label="Student referral: referrer payout">{money("referralStudentReferrerCents")}</FormField>
        </div>
        <FormField label="Share message ({link} is replaced)" className="mt-3">
          <Textarea value={v.referralShareText} onChange={(e) => setV({ ...v, referralShareText: e.target.value })} className="min-h-16" />
        </FormField>
      </Card>
      <Card title="Crews, tips & claims">
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label="Default tip per crew member" help={`Currently ${formatCents(v.tipDefaultCents)}`}>
            {money("tipDefaultCents")}
          </FormField>
          <FormField label="Claim window (days after delivery)">
            <Input type="number" value={v.claimWindowDays} onChange={(e) => setV({ ...v, claimWindowDays: Number(e.target.value) })} />
          </FormField>
          <FormField label="Crew roles" help="Comma separated">
            <Input defaultValue={v.crewRoles.join(", ")} onBlur={(e) => setV({ ...v, crewRoles: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
          </FormField>
        </div>
      </Card>
      <Card title="Contact info">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Phone">
            <Input value={v.companyPhone} onChange={(e) => setV({ ...v, companyPhone: e.target.value })} />
          </FormField>
          <FormField label="Email">
            <Input value={v.companyEmail} onChange={(e) => setV({ ...v, companyEmail: e.target.value })} />
          </FormField>
        </div>
      </Card>
    </div>
  );
}
