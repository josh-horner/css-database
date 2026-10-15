"use client";
/** One booking for the customer: status timeline, appointments, digital closet, billing, people, referrals, claims. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { cx, formatCents } from "@css/ui";
import { SMS_CONSENT_COPY } from "@css/ui/fields";
import { Alert, Badge, Button, Card, Checkbox, FormField, Input, Modal, Select, Textarea, download, errorText, formatDate } from "@css/ui/kit";
import { useTRPC } from "@css/ui/trpc";
import { Shell } from "../../../../components/shell";
import { icsFor, ShareReferral } from "../../../../components/share";

export default function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const trpc = useTRPC();
  const router = useRouter();
  const q = useQuery(trpc.portal.account.booking.queryOptions({ id }, { retry: false }));
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries();
  const [modal, setModal] = useState<null | { kind: "reschedule"; appointmentId: string } | { kind: "delivery" } | { kind: "invite" } | { kind: "claim" }>(null);
  const accept = useMutation(trpc.portal.account.acceptService.mutationOptions({ onSuccess: invalidate }));
  const again = useMutation(trpc.portal.account.signupAgain.mutationOptions({ onSuccess: () => router.push("/signup") }));
  const b = q.data;

  if (q.isLoading) return <Shell>Loading…</Shell>;
  if (!b)
    return (
      <Shell>
        <p className="text-slate-600">
          We couldn't find that booking for this login. <Link href="/account" className="text-brand underline">Back to your account</Link>
        </p>
      </Shell>
    );

  return (
    <Shell>
      <Link href="/account" className="text-sm text-slate-500 hover:text-slate-800">
        ← All bookings
      </Link>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            {b.school && <span className="h-4 w-4 rounded-full" style={{ background: b.school.color }} />}
            <h1 className="text-3xl font-black tabular-nums">#{b.confirmationNumber}</h1>
          </div>
          <p className="text-sm text-slate-600">
            {b.season} · {b.school?.shortName} {b.residence && `· ${b.residence}`} {b.room && `· ${b.room}`}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/account/bookings/${b.id}/labels`} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium">
            Print labels
          </Link>
          {b.signupAgain && (
            <Button size="sm" onClick={() => again.mutate({ bookingId: b.id })} loading={again.isPending}>
              Sign up again
            </Button>
          )}
        </div>
      </div>

      {b.lifecycle === "cancelled" ? (
        <Alert tone="red">This booking was cancelled.</Alert>
      ) : (
        <ol className="mt-5 grid grid-cols-5 gap-1 text-center text-[11px] sm:text-xs">
          {b.timeline.map((t) => (
            <li key={t.step} className={cx("border-t-4 pt-1", t.done ? "border-brand text-slate-900" : "border-slate-200 text-slate-400", t.current && "font-semibold")}>
              {t.label}
            </li>
          ))}
        </ol>
      )}

      <div className="mt-5 space-y-4">
        {b.services
          .filter((s) => s.needsAcceptance)
          .map((s) => (
            <Alert key={s.id} tone="amber">
              CSS added <strong>{s.name}</strong>
              {s.reason ? ` (${s.reason})` : ""}. Please review and accept.{" "}
              <Button size="sm" className="ml-2" onClick={() => accept.mutate({ bookingServiceId: s.id })} loading={accept.isPending}>
                Accept
              </Button>
            </Alert>
          ))}

        <Card
          title="Appointments"
          actions={
            b.appointments.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => download(`css-${b.confirmationNumber}.ics`, icsFor(b.appointments, b.confirmationNumber), "text/calendar")}>
                Add to calendar
              </Button>
            )
          }
        >
          <ul className="divide-y divide-slate-100">
            {b.appointments.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <div className="font-medium capitalize">
                    {a.type} · {formatDate(a.date, { weekday: "long", month: "long", day: "numeric" })}
                  </div>
                  <div className="text-sm text-slate-500">
                    {a.window} · {a.address}
                  </div>
                </div>
                <div className="flex gap-2">
                  {a.trackingUrl && (
                    <Link href={a.trackingUrl} className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white">
                      Track crew
                    </Link>
                  )}
                  {a.rateUrl && (
                    <Link href={a.rateUrl} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm">
                      Rate & tip
                    </Link>
                  )}
                  {a.canReschedule && (
                    <Button size="sm" variant="secondary" onClick={() => setModal({ kind: "reschedule", appointmentId: a.id })}>
                      Change day
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {b.appointments.length === 0 && <p className="text-sm text-slate-500">Nothing scheduled.</p>}
          {b.canScheduleDelivery && (
            <Button className="mt-3" onClick={() => setModal({ kind: "delivery" })}>
              Schedule your delivery
            </Button>
          )}
        </Card>

        <Card title="Your stuff">
          {b.items.length === 0 ? (
            <p className="text-sm text-slate-500">After pickup, everything the crew picked up shows here with photos.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {b.items.map((i) => (
                <li key={i.id} className="flex items-start gap-3 py-2">
                  <div className="flex shrink-0 gap-1">
                    {i.photoIds.slice(0, 2).map((p) => (
                      <a key={p} href={`/photos/${p}`} target="_blank" rel="noreferrer">
                        <img src={`/photos/${p}`} alt="" className="h-14 w-14 rounded object-cover" />
                      </a>
                    ))}
                    {i.photoIds.length === 0 && <div className="h-14 w-14 rounded bg-slate-100" />}
                  </div>
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="font-medium">
                      {i.quantity} × {i.name}
                    </div>
                    {i.damageAtPickup && <div className="text-xs text-amber-700">Noted at pickup: {i.damageAtPickup}</div>}
                    <div className="text-xs text-slate-500">{i.status === "delivered" ? `Delivered (${i.deliveredQuantity})` : i.status.replace("_", " ")}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {b.billing.canSee && (
          <Card title="Billing">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-slate-600">Balance</span>
              <span className={cx("text-xl font-semibold", b.billing.paymentStatus === "past_due" && "text-red-600")}>{formatCents(b.billing.balanceCents)}</span>
            </div>
            {b.billing.payLink && (
              <Alert tone="red">
                Your last payment didn't go through.{" "}
                <Link href={b.billing.payLink} className="font-medium underline">
                  Pay or update your card
                </Link>
              </Alert>
            )}
            {b.billing.pendingReview && <p className="mt-1 text-xs text-slate-500">Charges from pickup are being reviewed and will be billed to your card on file.</p>}
            {b.billing.card && (
              <p className="mt-2 text-sm text-slate-600">
                Card on file: {b.billing.card.brand} •••• {b.billing.card.last4} (exp {b.billing.card.exp})
              </p>
            )}
            {b.billing.authorizationText && <p className="mt-1 text-xs text-slate-500">You agreed: “{b.billing.authorizationText}”</p>}
            <div className="mt-3 space-y-3">
              {b.billing.invoices.map((inv) => (
                <details key={inv.id} className="rounded-md border border-slate-200 p-2 text-sm">
                  <summary className="flex cursor-pointer justify-between">
                    <span>
                      Invoice {inv.issuedAt ? new Date(inv.issuedAt).toLocaleDateString() : ""} <Badge tone={inv.status === "paid" ? "green" : "amber"}>{inv.status}</Badge>
                    </span>
                    <span>{formatCents(inv.totalCents)}</span>
                  </summary>
                  <ul className="mt-2 space-y-0.5 text-slate-600">
                    {inv.lines.map((l, i) => (
                      <li key={i} className="flex justify-between">
                        <span>
                          {l.quantity} × {l.description}
                        </span>
                        <span>{l.kind === "discount" ? "−" : ""}{formatCents(l.quantity * l.unitPriceCents)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          </Card>
        )}

        <Card title="People on this booking" actions={b.canInvite && <Button size="sm" variant="secondary" onClick={() => setModal({ kind: "invite" })}>Add a parent or guardian</Button>}>
          <ul className="space-y-1 text-sm">
            {b.people.map((p) => (
              <li key={p.personId}>
                <span className="font-medium">{p.name}</span> <span className="text-slate-500">({p.roles.join(", ")})</span>
                <div className="text-xs text-slate-500">{p.contacts.join(" · ")}</div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">Anyone listed can sign in with their own email or phone to see this booking.</p>
        </Card>

        {b.referral.link && b.referral.shareText && (
          <Card title="Refer a friend">
            <p className="mb-2 text-sm text-slate-600">
              Your code <strong>{b.referral.code}</strong> · {b.referral.count} friend{b.referral.count === 1 ? "" : "s"} signed up so far.
            </p>
            <ShareReferral link={b.referral.link} text={b.referral.shareText} />
          </Card>
        )}

        <Card title="Damage or something missing?">
          {b.claims.map((c) => (
            <div key={c.id} className="mb-2 rounded-md border border-slate-200 p-2 text-sm">
              <Badge tone={c.status === "resolved" ? "green" : c.status === "denied" ? "red" : "amber"}>{c.status}</Badge> <span className="capitalize">{c.kind}</span>: {c.description}
              {c.amountCents ? ` · ${formatCents(c.amountCents)} ${c.resolution}` : ""}
            </div>
          ))}
          {b.claimWindow.open ? (
            <Button variant="secondary" onClick={() => setModal({ kind: "claim" })}>
              File a claim
            </Button>
          ) : (
            <p className="text-sm text-slate-500">
              {b.claimWindow.deliveredOn
                ? `Claims could be filed within ${b.claimWindow.windowDays} days after delivery (${formatDate(b.claimWindow.deliveredOn)}).`
                : `After delivery you'll have ${b.claimWindow.windowDays} days to file a claim online, with photos.`}
            </p>
          )}
        </Card>
      </div>

      {modal?.kind === "reschedule" && <SlotModal bookingId={b.id} type="pickup" appointmentId={modal.appointmentId} onClose={() => setModal(null)} />}
      {modal?.kind === "delivery" && <SlotModal bookingId={b.id} type="delivery" onClose={() => setModal(null)} />}
      {modal?.kind === "invite" && <InviteModal bookingId={b.id} onClose={() => setModal(null)} />}
      {modal?.kind === "claim" && <ClaimModal bookingId={b.id} items={b.items} onClose={() => setModal(null)} />}
    </Shell>
  );
}

function SlotModal({ bookingId, type, appointmentId, onClose }: { bookingId: string; type: "pickup" | "delivery"; appointmentId?: string; onClose: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const slots = useQuery(trpc.portal.account.slots.queryOptions({ bookingId, type }));
  const [pick, setPick] = useState<string | null>(null);
  const done = () => {
    void qc.invalidateQueries();
    onClose();
  };
  const reschedule = useMutation(trpc.portal.account.reschedule.mutationOptions({ onSuccess: done }));
  const schedule = useMutation(trpc.portal.account.scheduleDelivery.mutationOptions({ onSuccess: done }));
  const byDate = new Map<string, NonNullable<typeof slots.data>>();
  for (const s of slots.data ?? []) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
  return (
    <Modal open onClose={onClose} title={type === "pickup" ? "Change your pickup day" : "Schedule your delivery"}>
      {slots.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {slots.data?.length === 0 && <p className="text-sm text-slate-600">No open days right now. Text or email us and we'll help.</p>}
      <div className="max-h-96 space-y-2 overflow-y-auto">
        {[...byDate.entries()].map(([date, list]) => (
          <div key={date} className="flex flex-wrap items-center gap-2">
            <span className="w-28 text-sm font-medium">{formatDate(date)}</span>
            {list.map((s) => (
              <button key={s.id} onClick={() => setPick(s.id)} className={cx("rounded-md border px-3 py-1.5 text-xs", pick === s.id ? "border-brand bg-brand text-white" : "border-slate-300")}>
                {s.windowId ? s.label : "Any time that day"}
              </button>
            ))}
          </div>
        ))}
      </div>
      <Alert>{errorText(reschedule.error) ?? errorText(schedule.error)}</Alert>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={!pick}
          loading={reschedule.isPending || schedule.isPending}
          onClick={() => (appointmentId ? reschedule.mutate({ appointmentId, serviceDayId: pick! }) : schedule.mutate({ bookingId, serviceDayId: pick! }))}
        >
          Confirm
        </Button>
      </div>
    </Modal>
  );
}

function InviteModal({ bookingId, onClose }: { bookingId: string; onClose: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [p, setP] = useState({ firstName: "", lastName: "", email: "", phone: "", smsConsent: false });
  const invite = useMutation(
    trpc.portal.account.invite.mutationOptions({
      onSuccess: () => {
        void qc.invalidateQueries();
        onClose();
      },
    }),
  );
  return (
    <Modal open onClose={onClose} title="Add a parent or guardian">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="First name">
          <Input value={p.firstName} onChange={(e) => setP({ ...p, firstName: e.target.value })} />
        </FormField>
        <FormField label="Last name">
          <Input value={p.lastName} onChange={(e) => setP({ ...p, lastName: e.target.value })} />
        </FormField>
        <FormField label="Email">
          <Input type="email" value={p.email} onChange={(e) => setP({ ...p, email: e.target.value })} />
        </FormField>
        <FormField label="Mobile (optional)">
          <Input type="tel" value={p.phone} onChange={(e) => setP({ ...p, phone: e.target.value })} />
        </FormField>
      </div>
      {p.phone && (
        <div className="mt-2">
          <Checkbox checked={p.smsConsent} onChange={(v) => setP({ ...p, smsConsent: v })} label={`${SMS_CONSENT_COPY} (they agreed)`} />
        </div>
      )}
      <p className="mt-2 text-xs text-slate-500">We'll email them that they can sign in to see this booking.</p>
      <Alert>{errorText(invite.error)}</Alert>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => invite.mutate({ bookingId, person: { ...p, phone: p.phone || undefined } })} loading={invite.isPending} disabled={!p.firstName || !p.email}>
          Add
        </Button>
      </div>
    </Modal>
  );
}

function ClaimModal({ bookingId, items, onClose }: { bookingId: string; items: { id: string; name: string; quantity: number }[]; onClose: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [kind, setKind] = useState<"damage" | "missing" | "other">("damage");
  const [itemIds, setItemIds] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [photoKeys, setPhotoKeys] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const submit = useMutation(
    trpc.portal.account.claim.mutationOptions({
      onSuccess: () => {
        void qc.invalidateQueries();
        onClose();
      },
    }),
  );
  const upload = async (files: FileList | null) => {
    if (!files) return;
    setUploading(true);
    setUploadError(null);
    try {
      for (const file of Array.from(files).slice(0, 10 - photoKeys.length)) {
        const form = new FormData();
        form.append("file", file);
        form.append("bookingId", bookingId);
        const res = await fetch("/portal/uploads", { method: "POST", body: form });
        const json = (await res.json()) as { key?: string; error?: string };
        if (!json.key) throw new Error(json.error ?? "Upload failed");
        setPhotoKeys((k) => [...k, json.key!]);
      }
    } catch (e) {
      setUploadError(errorText(e));
    } finally {
      setUploading(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="File a claim">
      <div className="space-y-3">
        <FormField label="What happened?">
          <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="damage">Something was damaged</option>
            <option value="missing">Something is missing</option>
            <option value="other">Other</option>
          </Select>
        </FormField>
        <FormField label="Which items?" help="From your pickup contract. Pickup and delivery photos are attached automatically.">
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2">
            {items.map((i) => (
              <Checkbox key={i.id} checked={itemIds.includes(i.id)} onChange={(on) => setItemIds(on ? [...itemIds, i.id] : itemIds.filter((x) => x !== i.id))} label={`${i.quantity} × ${i.name}`} />
            ))}
          </div>
        </FormField>
        <FormField label="Tell us what happened">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
        </FormField>
        <FormField label="Photos" help={`${photoKeys.length} added`}>
          <input type="file" accept="image/*" multiple capture="environment" onChange={(e) => void upload(e.target.files)} className="text-sm" />
          {uploading && <p className="text-xs text-slate-500">Uploading…</p>}
        </FormField>
        <Alert>{uploadError ?? errorText(submit.error)}</Alert>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => submit.mutate({ bookingId, kind, itemIds, description, photoKeys })} loading={submit.isPending} disabled={uploading || description.trim().length < 10}>
          Submit claim
        </Button>
      </div>
    </Modal>
  );
}
