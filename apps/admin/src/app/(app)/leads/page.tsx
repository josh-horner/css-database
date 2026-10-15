"use client";
/** Hot leads: stalled signups triaged by how far they got, with one-click outreach; and the signup funnel. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { cx, formatCents } from "@css/ui";
import { formatPhone } from "@css/domain";
import { Alert, Badge, Button, Card, Checkbox, Empty, Input, Modal, Select, Textarea, errorText, formatDate, timeAgo } from "@css/ui/kit";
import { useTRPC } from "@css/ui/trpc";
import { PageHeader, addDaysIso, todayIso } from "../../../components/page";
import type { Out } from "../../../components/types";

type Lead = Out["admin"]["leads"]["list"][number];

export default function Leads() {
  const trpc = useTRPC();
  const [includeAutomated, setIncludeAutomated] = useState(false);
  const [includeWorked, setIncludeWorked] = useState(false);
  const leads = useQuery(trpc.admin.leads.list.queryOptions({ includeAutomated, includeWorked }));
  const [contact, setContact] = useState<{ lead: Lead; channel: "email" | "text" } | null>(null);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Hot leads"
        subtitle="Signups that stopped. Early quitters get the automatic reminder; the ones who got far are worth a personal call."
        actions={
          <div className="flex gap-4">
            <Checkbox checked={includeAutomated} onChange={setIncludeAutomated} label="Include early-step drafts" />
            <Checkbox checked={includeWorked} onChange={setIncludeWorked} label="Include worked" />
          </div>
        }
      />
      <Funnel />
      <div className="space-y-2">
        {leads.data?.length === 0 && <Empty>No stalled signups right now.</Empty>}
        {leads.data?.map((l) => (
          <LeadRow key={l.bookingId} lead={l} onContact={(channel) => setContact({ lead: l, channel })} />
        ))}
      </div>
      {contact && <ContactModal lead={contact.lead} channel={contact.channel} onClose={() => setContact(null)} />}
    </div>
  );
}

function LeadRow({ lead: l, onContact }: { lead: Lead; onContact: (c: "email" | "text") => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const outcome = useMutation(trpc.admin.leads.outcome.mutationOptions({ onSuccess: () => qc.invalidateQueries() }));
  return (
    <div className={cx("rounded-xl border bg-white p-3", l.priority === "high" ? "border-amber-300" : "border-slate-200")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/bookings/${l.bookingId}`} className="font-semibold hover:underline">
              {l.name || l.email}
            </Link>
            <Badge tone={l.priority === "high" ? "red" : l.priority === "low" ? "amber" : "slate"}>{l.priority === "high" ? "call" : l.priority === "low" ? "follow up" : "automatic"}</Badge>
            {l.cardFailed && <Badge tone="red">card failed</Badge>}
            {l.signerRole === "guardian" && <Badge tone="blue">parent</Badge>}
            {l.outreach.outcome && <Badge tone="green">{l.outreach.outcome.replace("_", " ")}</Badge>}
          </div>
          <div className="text-sm text-slate-600">
            Stopped at <strong>{l.stepTitle}</strong> {timeAgo(l.lastActivityAt)} · {l.services.join(", ") || "no services yet"} {l.school && `· ${l.school}`}
            {l.estimateCents > 0 && ` · est. ${formatCents(l.estimateCents)}+`}
          </div>
          <div className="text-xs text-slate-500">
            {l.email} {l.phone && `· ${formatPhone(l.phone)}`} {l.nextPickupDay && `· next ${l.school} pickup day ${formatDate(l.nextPickupDay)}`}
            {l.reminderSentAt && ` · reminder sent ${timeAgo(l.reminderSentAt)}`}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {l.phone && (
            <a href={`tel:${l.phone}`} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium">
              Call
            </a>
          )}
          <Button size="sm" variant="secondary" onClick={() => onContact("email")} disabled={!l.email}>
            Email
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onContact("text")} disabled={!l.canText} title={l.canText ? "" : "They didn't agree to texts"}>
            Text
          </Button>
          <Select
            className="w-36 py-1 text-xs"
            value=""
            onChange={(e) => e.target.value && outcome.mutate({ bookingId: l.bookingId, outcome: e.target.value as "reached", note: null })}
          >
            <option value="">Log outcome…</option>
            <option value="reached">Reached</option>
            <option value="left_vm">Left voicemail</option>
            <option value="not_interested">Not interested</option>
            <option value="completed">Completed signup</option>
          </Select>
        </div>
      </div>
    </div>
  );
}

function ContactModal({ lead, channel, onClose }: { lead: Lead; channel: "email" | "text"; onClose: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const first = lead.name?.split(" ")[0] ?? "there";
  const [subject, setSubject] = useState("Finishing your CSS signup");
  const [body, setBody] = useState(
    channel === "email"
      ? `Hi ${first},\n\nI saw you started signing up for ${lead.services[0] ?? "storage"} with College Student Storage. Anything I can help with? Reply here or call me anytime.`
      : `Hi ${first}, it's CSS. Saw you started signing up. Need a hand? Finish here:`,
  );
  const done = { onSuccess: () => (void qc.invalidateQueries(), onClose()) };
  const email = useMutation(trpc.admin.leads.email.mutationOptions(done));
  const text = useMutation(trpc.admin.leads.text.mutationOptions(done));
  return (
    <Modal open onClose={onClose} title={channel === "email" ? `Email ${lead.email}` : `Text ${lead.phone}`}>
      <div className="space-y-3">
        {channel === "email" && <Input value={subject} onChange={(e) => setSubject(e.target.value)} />}
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-32" />
        <p className="text-xs text-slate-500">A link back to their signup (at the step they stopped) is added automatically. It's logged in Conversations.</p>
        <Alert>{errorText(email.error ?? text.error)}</Alert>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          loading={email.isPending || text.isPending}
          onClick={() => (channel === "email" ? email.mutate({ bookingId: lead.bookingId, subject, body }) : text.mutate({ bookingId: lead.bookingId, body }))}
        >
          Send
        </Button>
      </div>
    </Modal>
  );
}

function Funnel() {
  const trpc = useTRPC();
  const [from, setFrom] = useState(addDaysIso(todayIso(), -60));
  const [to, setTo] = useState(todayIso());
  const lookups = useQuery(trpc.admin.bookings.lookups.queryOptions()).data;
  const [schoolId, setSchoolId] = useState("");
  const f = useQuery(trpc.admin.leads.funnel.queryOptions({ from, to, schoolId: schoolId || null })).data;
  const top = f?.[0]?.reached || 1;
  return (
    <Card
      title="Signup funnel"
      actions={
        <div className="flex flex-wrap gap-2">
          <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
          <Select className="w-36" value={schoolId} onChange={(e) => setSchoolId(e.target.value)}>
            <option value="">All schools</option>
            {lookups?.schools.map((s) => (
              <option key={s.id} value={s.id}>
                {s.shortName}
              </option>
            ))}
          </Select>
        </div>
      }
    >
      <ul className="space-y-1.5">
        {f?.map((row) => (
          <li key={row.step} className="flex items-center gap-3 text-sm">
            <span className="w-28 shrink-0">{row.title}</span>
            <div className="h-5 flex-1 overflow-hidden rounded bg-slate-100">
              <div className="h-full bg-brand/70" style={{ width: `${(row.reached / top) * 100}%` }} />
            </div>
            <span className="w-14 text-right tabular-nums">{row.reached}</span>
            <span className="w-28 text-right text-xs text-slate-500">
              {row.dropOff > 0 ? `−${row.dropOff} here` : ""} {row.errors ? `· ${row.errors} errors` : ""}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
