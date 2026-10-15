"use client";
/** Customer 360: everything about one booking, and every staff action on it (each one audited). */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { use, useState } from "react";
import { cx, formatCents, parseDollars } from "@css/ui";
import { SMS_CONSENT_COPY } from "@css/ui/fields";
import { Alert, Badge, Button, Card, Checkbox, Empty, FormField, Input, Modal, Select, Tabs, Textarea, errorText, formatDate, formatDateTime, timeAgo } from "@css/ui/kit";
import { useTRPC } from "@css/ui/trpc";
import { LIFECYCLE_TONE, PAYMENT_TONE, PageHeader, human } from "../../../../components/page";
import { StaffFields } from "../../../../components/service-form";
import type { BookingDetail } from "../../../../components/types";

type ModalState =
  | { kind: "person"; personId: string }
  | { kind: "party" }
  | { kind: "reschedule"; appointmentId: string; type: string }
  | { kind: "appointment" }
  | { kind: "service" }
  | { kind: "line"; bookingServiceId?: string }
  | { kind: "refund"; paymentId: string; max: number }
  | { kind: "writeoff" }
  | { kind: "cancel" }
  | { kind: "status" }
  | { kind: "message" }
  | null;

export default function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const trpc = useTRPC();
  const qc = useQueryClient();
  const q = useQuery(trpc.admin.bookings.get.queryOptions({ id }));
  const me = useQuery(trpc.admin.me.queryOptions()).data;
  const [modal, setModal] = useState<ModalState>(null);
  const [tab, setTab] = useState<"items" | "messages" | "history" | "funnel">("items");
  const invalidate = () => qc.invalidateQueries();
  const b = q.data;
  if (q.isError) return <Alert>{errorText(q.error)}</Alert>;
  if (!b) return <p className="text-slate-500">Loading…</p>;
  const close = () => setModal(null);
  const isDraft = b.lifecycle === "draft";
  const live = !["draft", "cancelled"].includes(b.lifecycle);

  return (
    <div className="space-y-4">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {b.school && <span className="h-4 w-4 rounded-full" style={{ background: b.school.color }} title={b.school.name} />}
            {b.confirmationNumber ? <span className="tabular-nums">#{b.confirmationNumber}</span> : <span className="text-slate-400">Draft</span>}
            <span>{b.people.find((p) => p.roles.includes("customer") || p.roles.includes("student"))?.name ?? b.people[0]?.name}</span>
            <Badge tone={LIFECYCLE_TONE[b.lifecycle]}>{human(b.lifecycle)}</Badge>
            {!isDraft && <Badge tone={PAYMENT_TONE[b.ledger.paymentStatus]}>{human(b.ledger.paymentStatus)}</Badge>}
            {b.flags.map((f) => (
              <Badge key={f} tone="amber">
                {human(f)}
              </Badge>
            ))}
          </span>
        }
        subtitle={
          <>
            {b.season.name} · {b.school?.shortName ?? "No school"} {b.residence && `· ${b.residence.name}`} {b.room && `· room ${b.room}`} {b.address && `· ${b.address}`}
            {isDraft && ` · stopped at "${b.stepReached}" ${timeAgo(b.lastActivityAt)}`}
          </>
        }
        actions={
          <>
            {live && <Button onClick={() => setModal({ kind: "service" })}>Add service</Button>}
            <Button variant="secondary" onClick={() => setModal({ kind: "message" })}>
              Message
            </Button>
            {b.confirmationNumber && (
              <Link href={`/bookings/${b.id}/labels`} className="rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium">
                Labels
              </Link>
            )}
            {live && (
              <Button variant="ghost" onClick={() => setModal({ kind: "status" })}>
                Status…
              </Button>
            )}
            {live && (
              <Button variant="ghost" className="text-red-600" onClick={() => setModal({ kind: "cancel" })}>
                Cancel booking
              </Button>
            )}
          </>
        }
      />
      {b.cancelReason && <Alert>Cancelled: {b.cancelReason}</Alert>}
      {b.collections && (
        <Alert tone="red">
          Card declined {b.collections.failedAttempts}×. {b.collections.status === "collections" ? "Automatic retries are done; follow up personally." : `Next retry ${formatDateTime(b.collections.nextAttemptAt)}.`}
        </Alert>
      )}
      {b.otherBookings.length > 0 && (
        <p className="text-sm text-slate-600">
          Also:{" "}
          {b.otherBookings.map((o, i) => (
            <span key={o.id}>
              {i > 0 && ", "}
              <Link href={`/bookings/${o.id}`} className="text-brand underline">
                {o.confirmationNumber ? `#${o.confirmationNumber}` : "draft"} ({o.season}, {human(o.lifecycle)})
              </Link>
            </span>
          ))}
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          <PeopleCard b={b} onEdit={(personId) => setModal({ kind: "person", personId })} onAdd={() => setModal({ kind: "party" })} />
          <Card title="Services">
            <ul className="space-y-3">
              {b.services.map((s) => (
                <li key={s.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{s.name}</span>
                    {s.source !== "signup" && <Badge tone="purple">added by staff</Badge>}
                    {s.acceptanceRequired && <Badge tone={s.acceptedAt ? "green" : "amber"}>{s.acceptedAt ? "accepted" : "awaiting customer OK"}</Badge>}
                  </div>
                  {s.reason && <p className="text-xs text-slate-500">Reason: {s.reason}</p>}
                  <dl className="mt-1 grid grid-cols-[minmax(0,10rem)_1fr] gap-x-3 gap-y-0.5 text-sm">
                    {s.answers.map((a) => (
                      <div key={a.key} className="contents">
                        <dt className="text-slate-500">{a.label}</dt>
                        <dd>{a.display}</dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ul>
            {isDraft && b.draftAnswers.length > 0 && (
              <dl className="mt-2 grid grid-cols-[minmax(0,10rem)_1fr] gap-x-3 gap-y-0.5 text-sm">
                {b.draftAnswers.map((a) => (
                  <div key={a.key} className="contents">
                    <dt className="text-slate-500">{a.label}</dt>
                    <dd>{a.display}</dd>
                  </div>
                ))}
              </dl>
            )}
            <div className="mt-2 text-xs text-slate-500">
              {b.heardFrom && <>Heard from: {b.heardFrom} · </>}
              {b.referralCode && <>Referral code {b.referralCode} ({b.referrals.made} referred)</>}
              {b.referrals.referredBy && <> · referred with {b.referrals.referredBy.code}</>}
            </div>
          </Card>
          <AppointmentsCard b={b} onReschedule={(a) => setModal({ kind: "reschedule", appointmentId: a.id, type: a.type })} onAdd={() => setModal({ kind: "appointment" })} />
          <StorageCard b={b} onChanged={invalidate} />
          <NotesCard b={b} onChanged={invalidate} />
        </div>
        <div className="space-y-4">
          {!isDraft && <BillingCard b={b} role={me?.role ?? ""} onModal={setModal} onChanged={invalidate} />}
        </div>
      </div>

      <Card>
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "items", label: `Items & photos (${b.items.length})` },
            { id: "messages", label: `Messages (${b.messages.length})` },
            { id: "history", label: "History" },
            ...(isDraft ? [{ id: "funnel" as const, label: "Signup activity" }] : []),
          ]}
        />
        <div className="pt-3">
          {tab === "items" && <ItemsTab b={b} />}
          {tab === "messages" && <MessagesTab b={b} />}
          {tab === "history" && <HistoryTab b={b} />}
          {tab === "funnel" && (
            <ul className="space-y-1 text-sm">
              {b.funnel.map((f) => (
                <li key={f.id}>
                  {formatDateTime(f.at)} · {f.step} · {f.event} {f.meta ? <code className="text-xs text-slate-500">{JSON.stringify(f.meta)}</code> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {modal?.kind === "person" && <PersonModal b={b} personId={modal.personId} onClose={close} />}
      {modal?.kind === "party" && <PartyModal b={b} onClose={close} />}
      {modal?.kind === "reschedule" && <SlotModal b={b} appointmentId={modal.appointmentId} type={modal.type} onClose={close} />}
      {modal?.kind === "appointment" && <SlotModal b={b} onClose={close} />}
      {modal?.kind === "service" && <AddServiceModal b={b} onClose={close} />}
      {modal?.kind === "line" && <LineModal b={b} bookingServiceId={modal.bookingServiceId} onClose={close} />}
      {modal?.kind === "refund" && <RefundModal paymentId={modal.paymentId} max={modal.max} onClose={close} />}
      {modal?.kind === "writeoff" && <WriteOffModal b={b} onClose={close} />}
      {modal?.kind === "cancel" && <CancelModal b={b} onClose={close} />}
      {modal?.kind === "status" && <StatusModal b={b} onClose={close} />}
      {modal?.kind === "message" && <MessageModal b={b} onClose={close} />}
    </div>
  );
}

function useAct() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries();
}

function PeopleCard({ b, onEdit, onAdd }: { b: BookingDetail; onEdit: (personId: string) => void; onAdd: () => void }) {
  return (
    <Card title="People" actions={<Button size="sm" variant="secondary" onClick={onAdd}>Add person</Button>}>
      <ul className="space-y-3">
        {b.people.map((p) => (
          <li key={p.personId} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium">
                {p.name}{" "}
                {p.roles.map((r) => (
                  <Badge key={r} className="ml-1" tone={r === "payer" ? "green" : r === "signer" ? "slate" : "blue"}>
                    {r}
                  </Badge>
                ))}
              </div>
              {p.contacts.map((c) => (
                <div key={c.id} className="text-sm text-slate-600">
                  {c.kind === "phone" ? <a href={`tel:${c.value}`}>{c.display}</a> : <a href={`mailto:${c.value}`}>{c.display}</a>}
                  {c.verified && <span className="ml-1 text-xs text-green-700">✓ verified</span>}
                  {c.kind === "phone" && <span className={cx("ml-1 text-xs", c.sms ? "text-green-700" : "text-slate-400")}>{c.optedOut ? "texts: STOP" : c.sms ? "texts OK" : "no texts"}</span>}
                  {c.marketing && <span className="ml-1 text-xs text-slate-500">marketing OK</span>}
                </div>
              ))}
              {p.cards.map((c) => (
                <div key={c.id} className={cx("text-xs", c.active ? "text-slate-600" : "text-slate-400 line-through")}>
                  {c.brand} •••• {c.last4} exp {c.exp} ({c.provider})
                </div>
              ))}
            </div>
            <Button size="sm" variant="ghost" onClick={() => onEdit(p.personId)}>
              Edit
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function AppointmentsCard({ b, onReschedule, onAdd }: { b: BookingDetail; onReschedule: (a: BookingDetail["appointments"][number]) => void; onAdd: () => void }) {
  const trpc = useTRPC();
  const done = useAct();
  const cancel = useMutation(trpc.admin.bookings.cancelAppointment.mutationOptions({ onSuccess: done }));
  return (
    <Card title="Appointments" actions={b.lifecycle !== "draft" && <Button size="sm" variant="secondary" onClick={onAdd}>Add</Button>}>
      {b.appointments.length === 0 && <p className="text-sm text-slate-500">None.</p>}
      <ul className="divide-y divide-slate-100">
        {b.appointments.map((a) => (
          <li key={a.id} className={cx("flex flex-wrap items-start justify-between gap-2 py-2", a.cancelled && "opacity-50")}>
            <div>
              <div className="font-medium capitalize">
                {a.type} · {formatDate(a.date)} · {a.window}
                {a.overbooked && <Badge tone="red" className="ml-2">over capacity</Badge>}
                {a.cancelled && <Badge className="ml-2">cancelled</Badge>}
              </div>
              <div className="text-xs text-slate-500">
                {a.address}
                {a.room && `, room ${a.room}`} {a.notes && `· ${a.notes}`}
              </div>
              {a.job && (
                <div className="text-xs">
                  {a.job.crew ? (
                    <span className="inline-flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full" style={{ background: a.job.crewColor ?? undefined }} />
                      {a.job.crew}
                    </span>
                  ) : (
                    "Not on a crew yet"
                  )}{" "}
                  · {human(a.job.status)} {a.job.signedByName && `· signed by ${a.job.signedByName}`}
                </div>
              )}
            </div>
            {!a.cancelled && a.job?.status !== "completed" && (
              <div className="flex gap-1">
                <Button size="sm" variant="secondary" onClick={() => onReschedule(a)}>
                  Reschedule
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const reason = window.prompt("Why cancel this appointment?");
                    if (reason) cancel.mutate({ appointmentId: a.id, reason });
                  }}
                >
                  Cancel
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function StorageCard({ b, onChanged }: { b: BookingDetail; onChanged: () => void }) {
  const trpc = useTRPC();
  const [location, setLocation] = useState(b.storageLocation ?? "");
  const [flags, setFlags] = useState(b.flags.join(", "));
  const [until, setUntil] = useState(b.storageUntil ?? "");
  const loc = useMutation(trpc.admin.bookings.setStorageLocation.mutationOptions({ onSuccess: onChanged }));
  const update = useMutation(trpc.admin.bookings.update.mutationOptions({ onSuccess: onChanged }));
  if (b.lifecycle === "draft") return null;
  return (
    <Card title="Warehouse & flags">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Storage location" help="Where this booking's things are (zone/row/spot).">
          <div className="flex gap-2">
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. B-14" />
            <Button size="sm" variant="secondary" onClick={() => loc.mutate({ id: b.id, storageLocation: location || null, checkIn: true })} loading={loc.isPending}>
              Save
            </Button>
          </div>
        </FormField>
        <FormField label="Store until" help="Abroad/semester storage">
          <div className="flex gap-2">
            <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
            <Button size="sm" variant="secondary" onClick={() => update.mutate({ id: b.id, storageUntil: until || null })}>
              Save
            </Button>
          </div>
        </FormField>
        <FormField label="Flags" help="Comma separated: abroad, car_storage, vip, needs_info…" className="sm:col-span-2">
          <div className="flex gap-2">
            <Input value={flags} onChange={(e) => setFlags(e.target.value)} />
            <Button size="sm" variant="secondary" onClick={() => update.mutate({ id: b.id, flags: flags.split(",").map((f) => f.trim()).filter(Boolean) })} loading={update.isPending}>
              Save
            </Button>
          </div>
        </FormField>
      </div>
      <Alert>{errorText(loc.error) ?? errorText(update.error)}</Alert>
    </Card>
  );
}

function NotesCard({ b, onChanged }: { b: BookingDetail; onChanged: () => void }) {
  const trpc = useTRPC();
  const [body, setBody] = useState("");
  const add = useMutation(
    trpc.admin.bookings.addNote.mutationOptions({
      onSuccess: () => {
        setBody("");
        onChanged();
      },
    }),
  );
  return (
    <Card title="Notes">
      <div className="flex gap-2">
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a note (staff only)" className="min-h-10" />
        <Button onClick={() => add.mutate({ id: b.id, body, pinned: false })} disabled={!body.trim()} loading={add.isPending}>
          Add
        </Button>
      </div>
      <ul className="mt-3 space-y-2">
        {b.notes.map((n) => (
          <li key={n.id} className="rounded-md bg-slate-50 p-2 text-sm">
            <div className="whitespace-pre-wrap">{n.body}</div>
            <div className="mt-1 text-xs text-slate-500">
              {n.staff ?? "staff"} · {formatDateTime(n.createdAt)}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function BillingCard({ b, role, onModal, onChanged }: { b: BookingDetail; role: string; onModal: (m: ModalState) => void; onChanged: () => void }) {
  const trpc = useTRPC();
  const [result, setResult] = useState<string | null>(null);
  const approve = useMutation(
    trpc.admin.billing.approve.mutationOptions({
      onSuccess: (r) => {
        setResult(r.status === "succeeded" ? `Charged ${formatCents(r.amountCents)}` : r.status === "failed" ? `Declined: ${"message" in r ? r.message : ""}. Customer notified; retry scheduled.` : "Nothing to charge");
        onChanged();
      },
    }),
  );
  const charge = useMutation(
    trpc.admin.billing.charge.mutationOptions({
      onSuccess: (r) => {
        setResult(r.status === "succeeded" ? `Charged ${formatCents(r.amountCents)}` : r.status === "failed" ? "Declined again" : "Nothing to charge");
        onChanged();
      },
    }),
  );
  const waive = useMutation(trpc.admin.billing.waiveCardFee.mutationOptions({ onSuccess: onChanged }));
  const removeLine = useMutation(trpc.admin.billing.removeLine.mutationOptions({ onSuccess: onChanged }));
  const updateLine = useMutation(trpc.admin.billing.updateLine.mutationOptions({ onSuccess: onChanged }));
  const voidInv = useMutation(trpc.admin.billing.void.mutationOptions({ onSuccess: onChanged }));
  const error = approve.error ?? charge.error ?? waive.error ?? removeLine.error ?? updateLine.error ?? voidInv.error;
  const L = b.ledger;
  return (
    <Card
      title="Billing"
      actions={
        <>
          <Button size="sm" variant="secondary" onClick={() => onModal({ kind: "line" })}>
            Add charge / discount
          </Button>
          {role === "owner" && L.balanceCents > 0 && (
            <Button size="sm" variant="ghost" onClick={() => onModal({ kind: "writeoff" })}>
              Write off
            </Button>
          )}
        </>
      }
    >
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-sm text-slate-500">Balance owed (issued invoices − payments)</span>
        <span className={cx("text-2xl font-semibold", L.balanceCents > 0 && "text-amber-700", L.paymentStatus === "past_due" && "text-red-600")}>{formatCents(L.balanceCents)}</span>
      </div>
      <Alert tone="green">{result}</Alert>
      <Alert>{errorText(error)}</Alert>
      <div className="space-y-3">
        {L.invoices.map((inv) => {
          const editable = inv.status === "draft" || inv.status === "pending_review";
          return (
            <div key={inv.id} className={cx("rounded-lg border p-3", editable ? "border-amber-200 bg-amber-50/40" : "border-slate-200", inv.status === "void" && "opacity-50")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm">
                  <Badge tone={inv.status === "paid" ? "green" : inv.status === "issued" ? "amber" : editable ? "blue" : "slate"}>{editable ? "open bill (not charged yet)" : inv.status}</Badge>{" "}
                  <span className="text-slate-500">
                    {inv.source} · {formatDateTime(inv.issuedAt ?? inv.createdAt)} {inv.approvedBy && `· approved by ${inv.approvedBy}`}
                  </span>
                </div>
                <div className="font-semibold">{formatCents(inv.totalCents)}</div>
              </div>
              <table className="mt-2 w-full text-sm">
                <tbody>
                  {inv.lines.map((l) => (
                    <tr key={l.id} className={cx("border-t border-slate-100", l.quantity === 0 && "text-slate-400 line-through")}>
                      <td className="py-1 pr-2">
                        {l.description}
                        {l.kind !== "charge" && <Badge className="ml-1">{l.kind.replace("_", " ")}</Badge>}
                        {l.needsPrice && <Badge tone="red" className="ml-1">needs price</Badge>}
                        {l.reason && <div className="text-xs text-slate-500">{l.reason}</div>}
                      </td>
                      <td className="w-12 py-1 text-right">{l.quantity}×</td>
                      <td className="w-24 py-1 text-right">
                        {editable && l.kind === "charge" && l.quantity > 0 ? (
                          <PriceInput cents={l.unitPriceCents} onSave={(c) => updateLine.mutate({ lineId: l.id, unitPriceCents: c })} />
                        ) : (
                          formatCents(l.unitPriceCents)
                        )}
                      </td>
                      <td className="w-24 py-1 text-right">{l.kind === "discount" ? "−" : ""}{formatCents(l.quantity * l.unitPriceCents)}</td>
                      <td className="w-8 py-1 text-right">
                        {editable && l.quantity > 0 && l.kind !== "card_fee" && (
                          <button
                            className="text-slate-400 hover:text-red-600"
                            title="Remove (kept with a reason)"
                            onClick={() => {
                              const reason = window.prompt("Why remove this line?");
                              if (reason) removeLine.mutate({ lineId: l.id, reason });
                            }}
                          >
                            ✕
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {editable && (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <Checkbox checked={inv.waiveCardFee} onChange={(v) => waive.mutate({ invoiceId: inv.id, waive: v })} label="Waive 3% card fee" />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const reason = window.prompt("Why void this bill?");
                        if (reason) voidInv.mutate({ invoiceId: inv.id, reason });
                      }}
                    >
                      Void
                    </Button>
                    <Button size="sm" onClick={() => approve.mutate({ invoiceId: inv.id })} loading={approve.isPending} disabled={inv.lines.some((l) => l.needsPrice)}>
                      Approve & charge card
                    </Button>
                  </div>
                </div>
              )}
              {inv.status === "issued" && inv.balanceCents > 0 && (
                <div className="mt-2 flex justify-end">
                  <Button size="sm" onClick={() => charge.mutate({ invoiceId: inv.id })} loading={charge.isPending}>
                    Charge {formatCents(inv.balanceCents)} now
                  </Button>
                </div>
              )}
            </div>
          );
        })}
        {L.invoices.length === 0 && <Empty>No charges yet.</Empty>}
      </div>
      <h3 className="mt-4 text-sm font-semibold">Payments</h3>
      <ul className="mt-1 divide-y divide-slate-100 text-sm">
        {L.payments.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
            <span>
              {formatDateTime(p.createdAt)} · {p.kind} · <Badge tone={p.status === "succeeded" ? "green" : p.status === "failed" ? "red" : "slate"}>{p.status}</Badge>
              {p.failureMessage && <span className="ml-1 text-xs text-red-600">{p.failureMessage}</span>}
              <span className="ml-1 text-xs text-slate-400">{p.providerRef}</span>
            </span>
            <span className="flex items-center gap-2">
              {p.kind === "refund" ? "−" : ""}
              {formatCents(p.amountCents)}
              {p.kind === "charge" && p.status === "succeeded" && (
                <Button size="sm" variant="ghost" onClick={() => onModal({ kind: "refund", paymentId: p.id, max: p.amountCents })}>
                  Refund
                </Button>
              )}
            </span>
          </li>
        ))}
        {L.writeOffs.map((w) => (
          <li key={w.id} className="flex justify-between py-1.5 text-slate-500">
            <span>
              Written off by {w.staff}: {w.reason}
            </span>
            <span>{formatCents(w.amountCents)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PriceInput({ cents, onSave }: { cents: number; onSave: (c: number) => void }) {
  const [v, setV] = useState((cents / 100).toFixed(2));
  return (
    <input
      className="w-20 rounded border border-slate-300 px-1 py-0.5 text-right text-sm"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const c = parseDollars(v);
        if (c !== null && c !== cents) onSave(c);
      }}
    />
  );
}

function ItemsTab({ b }: { b: BookingDetail }) {
  if (!b.items.length && !b.otherPhotos.length) return <Empty>No items yet. The crew's digital contract fills this in at pickup.</Empty>;
  return (
    <div className="space-y-3">
      <ul className="grid gap-3 md:grid-cols-2">
        {b.items.map((i) => (
          <li key={i.id} className="flex gap-3 rounded-lg border border-slate-200 p-2">
            <div className="flex shrink-0 gap-1">
              {i.photoIds.slice(0, 3).map((p) => (
                <a key={p} href={`/photos/${p}`} target="_blank" rel="noreferrer">
                  <img src={`/photos/${p}`} alt="" className="h-16 w-16 rounded object-cover" />
                </a>
              ))}
            </div>
            <div className="text-sm">
              <div className="font-medium">
                {i.quantity} × {i.name}
              </div>
              <div className="text-xs text-slate-500">
                {human(i.status)} {i.deliveredQuantity ? `· ${i.deliveredQuantity} delivered` : ""}
              </div>
              {i.damage && <div className="text-xs text-amber-700">Damage at pickup: {i.damage}</div>}
            </div>
          </li>
        ))}
      </ul>
      {b.otherPhotos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {b.otherPhotos.map((p) => (
            <a key={p.id} href={`/photos/${p.id}`} target="_blank" rel="noreferrer" title={p.kind}>
              <img src={`/photos/${p.id}`} alt={p.kind} className="h-20 w-20 rounded object-cover" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function MessagesTab({ b }: { b: BookingDetail }) {
  if (!b.messages.length) return <Empty>No messages yet.</Empty>;
  return (
    <ul className="space-y-2">
      {b.messages.map((m) => (
        <li key={m.id} className={cx("rounded-lg p-2 text-sm", m.direction === "inbound" ? "bg-slate-100" : m.author === "ai" ? "bg-purple-50" : "bg-blue-50")}>
          <div className="flex flex-wrap justify-between gap-2 text-xs text-slate-500">
            <span>
              {m.channel.toUpperCase()} · {m.direction === "inbound" ? "from customer" : `${m.author} → ${m.to}`} {m.purpose && `· ${human(m.purpose)}`}
            </span>
            <span>
              {formatDateTime(m.at)} · {m.status}
            </span>
          </div>
          {m.subject && <div className="font-medium">{m.subject}</div>}
          <div className="whitespace-pre-wrap">{m.body}</div>
        </li>
      ))}
    </ul>
  );
}

function HistoryTab({ b }: { b: BookingDetail }) {
  return (
    <ul className="space-y-1 text-sm">
      {b.audit.map((a) => (
        <li key={a.id} className="flex flex-wrap gap-2">
          <span className="w-36 shrink-0 text-xs text-slate-500">{formatDateTime(a.at)}</span>
          <span className="font-medium">{a.actor}</span>
          <span>
            {human(a.action)} {a.entity !== "booking" && <span className="text-slate-500">({human(a.entity)})</span>}
          </span>
          {a.after != null && <code className="max-w-full truncate text-xs text-slate-500">{JSON.stringify(a.after)}</code>}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------------------------
// Modals

function ModalFooter({ onClose, onSave, loading, disabled, label = "Save", error }: { onClose: () => void; onSave: () => void; loading?: boolean; disabled?: boolean; label?: string; error?: unknown }) {
  return (
    <>
      <div className="mt-3">
        <Alert>{errorText(error)}</Alert>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={onSave} loading={loading} disabled={disabled}>
          {label}
        </Button>
      </div>
    </>
  );
}

function useClosingMutation<T>(onClose: () => void) {
  const qc = useQueryClient();
  return {
    onSuccess: (_: T) => {
      void qc.invalidateQueries();
      onClose();
    },
  };
}

function PersonModal({ b, personId, onClose }: { b: BookingDetail; personId: string; onClose: () => void }) {
  const trpc = useTRPC();
  const p = b.people.find((x) => x.personId === personId)!;
  const phone = p.contacts.find((c) => c.kind === "phone");
  const [v, setV] = useState({ firstName: p.firstName, lastName: p.lastName, email: p.contacts.find((c) => c.kind === "email")?.value ?? "", phone: phone?.value ?? "", smsConsent: !!phone?.sms });
  const m = useMutation(trpc.admin.bookings.updatePerson.mutationOptions(useClosingMutation(onClose)));
  return (
    <Modal open onClose={onClose} title={`Edit ${p.name}`}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="First name">
          <Input value={v.firstName} onChange={(e) => setV({ ...v, firstName: e.target.value })} />
        </FormField>
        <FormField label="Last name">
          <Input value={v.lastName} onChange={(e) => setV({ ...v, lastName: e.target.value })} />
        </FormField>
        <FormField label="Email" help="A new email is added; old ones are kept for history.">
          <Input value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
        </FormField>
        <FormField label="Mobile">
          <Input value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />
        </FormField>
      </div>
      <div className="mt-2">
        <Checkbox checked={v.smsConsent} onChange={(c) => setV({ ...v, smsConsent: c })} label={`${SMS_CONSENT_COPY} (customer agreed)`} help="Only check this if they told you they want texts." />
      </div>
      <ModalFooter onClose={onClose} error={m.error} loading={m.isPending} onSave={() => m.mutate({ bookingId: b.id, personId, ...v, email: v.email || null, phone: v.phone || null })} />
    </Modal>
  );
}

function PartyModal({ b, onClose }: { b: BookingDetail; onClose: () => void }) {
  const trpc = useTRPC();
  const [role, setRole] = useState<"guardian" | "payer" | "customer">("guardian");
  const [p, setP] = useState({ firstName: "", lastName: "", email: "", phone: "", smsConsent: false });
  const m = useMutation(trpc.admin.bookings.addParty.mutationOptions(useClosingMutation(onClose)));
  return (
    <Modal open onClose={onClose} title="Add a person to this booking">
      <FormField label="Role">
        <Select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
          <option value="guardian">Parent / guardian</option>
          <option value="payer">Payer</option>
          <option value="customer">Customer</option>
        </Select>
      </FormField>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <FormField label="First name">
          <Input value={p.firstName} onChange={(e) => setP({ ...p, firstName: e.target.value })} />
        </FormField>
        <FormField label="Last name">
          <Input value={p.lastName} onChange={(e) => setP({ ...p, lastName: e.target.value })} />
        </FormField>
        <FormField label="Email">
          <Input value={p.email} onChange={(e) => setP({ ...p, email: e.target.value })} />
        </FormField>
        <FormField label="Mobile">
          <Input value={p.phone} onChange={(e) => setP({ ...p, phone: e.target.value })} />
        </FormField>
      </div>
      {p.phone && (
        <div className="mt-2">
          <Checkbox checked={p.smsConsent} onChange={(c) => setP({ ...p, smsConsent: c })} label={`${SMS_CONSENT_COPY} (they agreed)`} />
        </div>
      )}
      <ModalFooter onClose={onClose} error={m.error} loading={m.isPending} disabled={!p.firstName} onSave={() => m.mutate({ bookingId: b.id, role, person: { ...p, phone: p.phone || undefined } })} label="Add and email them" />
    </Modal>
  );
}

function SlotModal({ b, appointmentId, type: initialType, onClose }: { b: BookingDetail; appointmentId?: string; type?: string; onClose: () => void }) {
  const trpc = useTRPC();
  const [type, setType] = useState<"pickup" | "delivery" | "move" | "service">((initialType as "pickup") ?? "delivery");
  const slotType = type === "delivery" ? "delivery" : "pickup";
  const slots = useQuery(trpc.admin.bookings.slots.queryOptions({ bookingId: b.id, type: slotType }));
  const [pick, setPick] = useState<{ serviceDayId: string | null; date: string; windowId: string | null } | null>(null);
  const [customDate, setCustomDate] = useState("");
  const [customWindow, setCustomWindow] = useState("");
  const [overbook, setOverbook] = useState("");
  const [notify, setNotify] = useState(true);
  const opts = useClosingMutation(onClose);
  const reschedule = useMutation(trpc.admin.bookings.reschedule.mutationOptions(opts));
  const add = useMutation(trpc.admin.bookings.addAppointment.mutationOptions(opts));
  const chosen = pick ?? (customDate ? { serviceDayId: null, date: customDate, windowId: customWindow || null } : null);
  const full = slots.data?.find((s) => s.id === pick?.serviceDayId && (s.remaining <= 0 || s.blocked));
  const byDate = new Map<string, NonNullable<typeof slots.data>>();
  for (const s of slots.data ?? []) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
  return (
    <Modal open onClose={onClose} title={appointmentId ? "Reschedule" : "Add appointment"} wide>
      {!appointmentId && (
        <FormField label="Type" className="mb-3">
          <Select value={type} onChange={(e) => setType(e.target.value as typeof type)} className="max-w-48">
            <option value="delivery">Delivery</option>
            <option value="pickup">Pickup</option>
            <option value="move">Move</option>
            <option value="service">Other service</option>
          </Select>
        </FormField>
      )}
      <p className="mb-2 text-sm text-slate-600">Capacity windows (booked/capacity). Full and closed windows can be used with a reason.</p>
      <div className="max-h-72 space-y-1.5 overflow-y-auto">
        {[...byDate.entries()].map(([date, list]) => (
          <div key={date} className="flex flex-wrap items-center gap-1.5">
            <span className="w-28 text-sm font-medium">{formatDate(date)}</span>
            {list.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setPick({ serviceDayId: s.id, date: s.date, windowId: s.windowId });
                  setCustomDate("");
                }}
                className={cx(
                  "rounded border px-2 py-1 text-xs",
                  pick?.serviceDayId === s.id ? "border-brand bg-brand text-white" : s.remaining <= 0 || s.blocked ? "border-red-200 bg-red-50 text-red-700" : "border-slate-300",
                )}
              >
                {s.campusScope !== "both" && `${s.campusScope}-campus `}
                {s.windowId ?? "day"} · {s.capacity - s.remaining}/{s.capacity}
                {s.blocked && " closed"}
              </button>
            ))}
          </div>
        ))}
        {slots.data?.length === 0 && <p className="text-sm text-slate-500">No capacity windows for this school; use a date below.</p>}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <FormField label="Or any date">
          <Input
            type="date"
            value={customDate}
            onChange={(e) => {
              setCustomDate(e.target.value);
              setPick(null);
            }}
          />
        </FormField>
        <FormField label="Window">
          <Select value={customWindow} onChange={(e) => setCustomWindow(e.target.value)}>
            <option value="">Any time</option>
            <option value="AM">AM 9:30–12:30</option>
            <option value="PM">PM 1:30–4:30</option>
          </Select>
        </FormField>
        {full && (
          <FormField label="Over capacity: reason">
            <Input value={overbook} onChange={(e) => setOverbook(e.target.value)} />
          </FormField>
        )}
      </div>
      <div className="mt-2">
        <Checkbox checked={notify} onChange={setNotify} label="Tell the customer (email, and text if they agreed)" />
      </div>
      <ModalFooter
        onClose={onClose}
        error={reschedule.error ?? add.error}
        loading={reschedule.isPending || add.isPending}
        disabled={!chosen?.date || (!!full && !overbook.trim())}
        onSave={() =>
          appointmentId
            ? reschedule.mutate({ appointmentId, date: chosen!.date, windowId: chosen!.windowId, serviceDayId: chosen!.serviceDayId, overbookReason: overbook || null, notify })
            : add.mutate({ bookingId: b.id, type, date: chosen!.date, windowId: chosen!.windowId, serviceDayId: chosen!.serviceDayId, overbookReason: overbook || null })
        }
      />
    </Modal>
  );
}

function AddServiceModal({ b, onClose }: { b: BookingDetail; onClose: () => void }) {
  const trpc = useTRPC();
  const lookups = useQuery(trpc.admin.bookings.lookups.queryOptions()).data;
  const [serviceId, setServiceId] = useState("");
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [reason, setReason] = useState("");
  const [acceptance, setAcceptance] = useState(false);
  const [notify, setNotify] = useState(true);
  const m = useMutation(trpc.admin.bookings.addService.mutationOptions(useClosingMutation(onClose)));
  const service = lookups?.services.find((s) => s.id === serviceId);
  // Don't re-ask what the booking already has (school, residence, people).
  const known = ["school", "residence", "student", "guardian", "customer"].filter((k) => b.services.some((s) => s.answers.some((a) => a.key === k)));
  return (
    <Modal open onClose={onClose} title="Add a service" wide>
      <div className="space-y-4">
        <FormField label="Service" help="Every charge belongs to a service on the booking. If this is really a separate engagement (e.g. car storage), create a new booking instead.">
          <Select
            value={serviceId}
            onChange={(e) => {
              setServiceId(e.target.value);
              setAnswers({});
            }}
          >
            <option value="">Choose…</option>
            {lookups?.services
              .filter((s) => s.active && !b.services.some((x) => x.serviceId === s.id))
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.staffOnly ? " (staff only)" : ""}
                </option>
              ))}
          </Select>
        </FormField>
        {service && lookups && (
          <StaffFields services={[service]} answers={answers} setAnswers={setAnswers} schools={lookups.schools} schoolId={b.school?.id ?? null} bookingId={b.id} hideKeys={known} />
        )}
        <FormField label="Reason" help="Shown on the booking and in the history.">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Parent called: wants in-room pickup" />
        </FormField>
        <Checkbox checked={acceptance} onChange={setAcceptance} label="Customer must accept before we schedule it" help="They get a link to review and accept." />
        <Checkbox checked={notify} onChange={setNotify} label="Notify the customer" />
      </div>
      <ModalFooter
        onClose={onClose}
        error={m.error}
        loading={m.isPending}
        disabled={!serviceId || reason.trim().length < 3}
        label="Add service"
        onSave={() => m.mutate({ bookingId: b.id, serviceId, answers, reason, acceptanceRequired: acceptance, notify })}
      />
    </Modal>
  );
}

function LineModal({ b, bookingServiceId, onClose }: { b: BookingDetail; bookingServiceId?: string; onClose: () => void }) {
  const trpc = useTRPC();
  const rate = useQuery(trpc.admin.config.rateCard.queryOptions({ seasonId: b.season.id })).data;
  const [serviceRow, setServiceRow] = useState(bookingServiceId ?? b.services[0]?.id ?? "");
  const [kind, setKind] = useState<"charge" | "discount" | "adjustment">("charge");
  const [rateId, setRateId] = useState("");
  const [description, setDescription] = useState("");
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [reason, setReason] = useState("");
  const m = useMutation(trpc.admin.billing.addLine.mutationOptions(useClosingMutation(onClose)));
  const item = rate?.items.find((r) => r.id === rateId);
  const cents = price ? parseDollars(price) : (item?.unitPriceCents ?? null);
  return (
    <Modal open onClose={onClose} title="Add to the open bill">
      <div className="space-y-3">
        <FormField label="For service" help="Not listed? Add the service first.">
          <Select value={serviceRow} onChange={(e) => setServiceRow(e.target.value)}>
            {b.services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Type">
          <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="charge">Charge</option>
            <option value="discount">Discount / credit</option>
            <option value="adjustment">Adjustment</option>
          </Select>
        </FormField>
        <FormField label="From the rate card" help="Or leave blank and describe it (needs a reason; shows in the ad-hoc lines report).">
          <Select value={rateId} onChange={(e) => setRateId(e.target.value)}>
            <option value="">Not on the rate card</option>
            {rate?.items
              .filter((r) => r.active)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.category}: {r.name} ({formatCents(r.unitPriceCents)}/{r.unit})
                </option>
              ))}
          </Select>
        </FormField>
        {!rateId && (
          <FormField label="Description">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </FormField>
        )}
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Quantity">
            <Input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
          </FormField>
          <FormField label="Unit price" help={item ? `Rate card: ${formatCents(item.unitPriceCents)}` : undefined}>
            <Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={item ? (item.unitPriceCents / 100).toFixed(2) : "0.00"} />
          </FormField>
        </div>
        <FormField label={rateId ? "Reason (optional)" : "Reason"}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </FormField>
        {cents !== null && <p className="text-sm text-slate-600">Line total: {formatCents((Number(qty) || 0) * cents)}</p>}
      </div>
      <ModalFooter
        onClose={onClose}
        error={m.error}
        loading={m.isPending}
        disabled={!serviceRow || !(Number(qty) >= 1) || cents === null}
        label="Add line"
        onSave={() =>
          m.mutate({ bookingId: b.id, bookingServiceId: serviceRow, kind, rateCardItemId: rateId || null, description: description || null, quantity: Number(qty), unitPriceCents: cents, reason: reason || null })
        }
      />
    </Modal>
  );
}

function RefundModal({ paymentId, max, onClose }: { paymentId: string; max: number; onClose: () => void }) {
  const trpc = useTRPC();
  const [amount, setAmount] = useState((max / 100).toFixed(2));
  const [reason, setReason] = useState("");
  const m = useMutation(trpc.admin.billing.refund.mutationOptions(useClosingMutation(onClose)));
  const cents = parseDollars(amount);
  return (
    <Modal open onClose={onClose} title="Refund">
      <div className="space-y-3">
        <FormField label="Amount" help={`Up to ${formatCents(max)}. Refunds over $100 need the owner.`}>
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} />
        </FormField>
        <FormField label="Reason">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </FormField>
      </div>
      <ModalFooter onClose={onClose} error={m.error} loading={m.isPending} disabled={!cents || !reason.trim()} label="Refund to card" onSave={() => m.mutate({ paymentId, amountCents: cents!, reason })} />
    </Modal>
  );
}

function WriteOffModal({ b, onClose }: { b: BookingDetail; onClose: () => void }) {
  const trpc = useTRPC();
  const [reason, setReason] = useState("");
  const m = useMutation(trpc.admin.billing.writeOff.mutationOptions(useClosingMutation(onClose)));
  return (
    <Modal open onClose={onClose} title={`Write off ${formatCents(b.ledger.balanceCents)}`}>
      <p className="text-sm text-slate-600">This zeroes the balance with a recorded reason (owner only). It also closes any collections case.</p>
      <FormField label="Reason" className="mt-3">
        <Input value={reason} onChange={(e) => setReason(e.target.value)} />
      </FormField>
      <ModalFooter onClose={onClose} error={m.error} loading={m.isPending} disabled={!reason.trim()} label="Write off" onSave={() => m.mutate({ bookingId: b.id, reason })} />
    </Modal>
  );
}

function CancelModal({ b, onClose }: { b: BookingDetail; onClose: () => void }) {
  const trpc = useTRPC();
  const [reason, setReason] = useState("");
  const m = useMutation(trpc.admin.bookings.cancel.mutationOptions(useClosingMutation(onClose)));
  return (
    <Modal open onClose={onClose} title={`Cancel #${b.confirmationNumber}`}>
      <p className="text-sm text-slate-600">Appointments come off the schedule and the confirmation number can be reused. Nothing is deleted. Refund the deposit separately if you're returning it.</p>
      <FormField label="Reason" className="mt-3">
        <Input value={reason} onChange={(e) => setReason(e.target.value)} />
      </FormField>
      <ModalFooter onClose={onClose} error={m.error} loading={m.isPending} disabled={reason.trim().length < 3} label="Cancel booking" onSave={() => m.mutate({ id: b.id, reason })} />
    </Modal>
  );
}

function StatusModal({ b, onClose }: { b: BookingDetail; onClose: () => void }) {
  const trpc = useTRPC();
  const [lifecycle, setLifecycle] = useState(b.lifecycle);
  const [reason, setReason] = useState("");
  const m = useMutation(trpc.admin.bookings.update.mutationOptions(useClosingMutation(onClose)));
  return (
    <Modal open onClose={onClose} title="Change status by hand">
      <p className="text-sm text-slate-600">Status normally follows what happens (signup, pickup, delivery). Closing requires a zero balance.</p>
      <div className="mt-3 space-y-3">
        <Select value={lifecycle} onChange={(e) => setLifecycle(e.target.value as typeof lifecycle)}>
          {["confirmed", "picked_up", "in_storage", "delivery_scheduled", "delivered", "closed"].map((l) => (
            <option key={l} value={l}>
              {human(l)}
            </option>
          ))}
        </Select>
        <FormField label="Reason">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </FormField>
      </div>
      <ModalFooter onClose={onClose} error={m.error} loading={m.isPending} disabled={!reason.trim() || lifecycle === b.lifecycle} onSave={() => m.mutate({ id: b.id, lifecycle: lifecycle as never, reason })} />
    </Modal>
  );
}

function MessageModal({ b, onClose }: { b: BookingDetail; onClose: () => void }) {
  const trpc = useTRPC();
  const [channel, setChannel] = useState<"email" | "sms">("email");
  const [subject, setSubject] = useState(b.confirmationNumber ? `About your CSS booking #${b.confirmationNumber}` : "College Student Storage");
  const [body, setBody] = useState("");
  const [result, setResult] = useState<number | null>(null);
  const m = useMutation(trpc.admin.bookings.message.mutationOptions({ onSuccess: (r) => setResult(r.sent) }));
  return (
    <Modal open onClose={onClose} title="Message everyone on this booking">
      <div className="space-y-3">
        <Select value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)} className="max-w-40">
          <option value="email">Email</option>
          <option value="sms">Text (only people who agreed)</option>
        </Select>
        {channel === "email" && <Input value={subject} onChange={(e) => setSubject(e.target.value)} />}
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-32" />
        {result !== null && <Alert tone="green">Sent to {result} recipient(s).</Alert>}
      </div>
      <ModalFooter onClose={onClose} error={m.error} loading={m.isPending} disabled={!body.trim()} label="Send" onSave={() => m.mutate({ bookingId: b.id, channel, subject, body })} />
    </Modal>
  );
}
