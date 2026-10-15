"use client";
/** Claims queue: worked periodically, with pickup and delivery photos for the lines involved. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { formatCents, parseDollars } from "@css/ui";
import { Alert, Badge, Button, Card, Checkbox, Empty, FormField, Input, Select, Textarea, errorText, formatDateTime } from "@css/ui/kit";
import { useTRPC } from "@css/ui/trpc";
import { PageHeader } from "../../../components/page";
import type { Out } from "../../../components/types";

type Claim = Out["admin"]["claims"]["list"][number];

export default function Claims() {
  const trpc = useTRPC();
  const [all, setAll] = useState(false);
  const list = useQuery(trpc.admin.claims.list.queryOptions({ status: all ? "all" : "open" }));
  return (
    <div className="space-y-4">
      <PageHeader title="Claims" subtitle="Filed online within the claim window after delivery. Work them in a batch; customers are notified automatically." actions={<Checkbox checked={all} onChange={setAll} label="Show closed" />} />
      {list.data?.length === 0 && <Empty>No open claims.</Empty>}
      {list.data?.map((c) => <ClaimCard key={c.id} c={c} />)}
    </div>
  );
}

function ClaimCard({ c }: { c: Claim }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const done = { onSuccess: () => void qc.invalidateQueries() };
  const resolve = useMutation(trpc.admin.claims.resolve.mutationOptions(done));
  const update = useMutation(trpc.admin.claims.update.mutationOptions(done));
  const [outcome, setOutcome] = useState<"refund" | "credit" | "payment" | "denied">("credit");
  const [amount, setAmount] = useState("");
  const [paymentId, setPaymentId] = useState(c.refundablePayments[0]?.id ?? "");
  const [note, setNote] = useState("");
  const open = c.status === "submitted" || c.status === "reviewing";
  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          <Link href={`/bookings/${c.bookingId}`} className="hover:underline">
            #{c.confirmationNumber} · {c.customerName}
          </Link>
          <Badge tone={c.kind === "damage" ? "amber" : c.kind === "missing" ? "red" : "slate"}>{c.kind}</Badge>
          <Badge tone={open ? "blue" : c.status === "denied" ? "red" : "green"}>{c.status}</Badge>
          {c.urgent && <Badge tone="red">urgent</Badge>}
        </span>
      }
      actions={
        open && (
          <>
            {c.status === "submitted" && (
              <Button size="sm" variant="secondary" onClick={() => update.mutate({ claimId: c.id, status: "reviewing" })}>
                Mark reviewing
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => update.mutate({ claimId: c.id, urgent: !c.urgent })}>
              {c.urgent ? "Not urgent" : "Urgent"}
            </Button>
          </>
        )
      }
    >
      <p className="text-sm text-slate-500">Filed {formatDateTime(c.createdAt)}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm">{c.description}</p>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div className="space-y-2">
          {c.items.map((i) => (
            <div key={i.id} className="rounded-md border border-slate-200 p-2 text-sm">
              <div className="font-medium">
                {i.quantity} × {i.name}
              </div>
              {i.damageAtPickup && <div className="text-xs text-amber-700">Noted at pickup: {i.damageAtPickup}</div>}
              <div className="mt-1 flex flex-wrap gap-1">
                {i.pickupPhotoIds.map((p) => (
                  <a key={p} href={`/photos/${p}`} target="_blank" rel="noreferrer">
                    <img src={`/photos/${p}`} alt="pickup" className="h-16 w-16 rounded object-cover" />
                  </a>
                ))}
                {i.pickupPhotoIds.length === 0 && <span className="text-xs text-slate-400">No pickup photos</span>}
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-2 text-sm">
          <div>
            <div className="text-xs font-semibold uppercase text-slate-500">Delivery photos</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {c.deliveryPhotoIds.map((p) => (
                <a key={p} href={`/photos/${p}`} target="_blank" rel="noreferrer">
                  <img src={`/photos/${p}`} alt="delivery" className="h-16 w-16 rounded object-cover" />
                </a>
              ))}
              {c.deliveryPhotoIds.length === 0 && <span className="text-xs text-slate-400">None</span>}
            </div>
          </div>
          {c.customerPhotoKeys.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase text-slate-500">Customer's photos</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {c.customerPhotoKeys.map((_, i) => (
                  <a key={i} href={`/claim-photos/${c.id}/${i}`} target="_blank" rel="noreferrer">
                    <img src={`/claim-photos/${c.id}/${i}`} alt="customer" className="h-16 w-16 rounded object-cover" />
                  </a>
                ))}
              </div>
            </div>
          )}
          <div className="text-xs text-slate-600">
            Crews: {c.crews.map((x) => `${x.type} ${x.date} (${x.crew ?? "?"})`).join(" · ") || "—"}
          </div>
        </div>
      </div>
      {open ? (
        <div className="mt-4 grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-4">
          <FormField label="Outcome">
            <Select value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)}>
              <option value="credit">Credit on account</option>
              <option value="refund">Refund to card</option>
              <option value="payment">Pay by check/other</option>
              <option value="denied">Deny</option>
            </Select>
          </FormField>
          {outcome !== "denied" && (
            <FormField label="Amount">
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            </FormField>
          )}
          {outcome === "refund" && (
            <FormField label="Refund payment">
              <Select value={paymentId} onChange={(e) => setPaymentId(e.target.value)}>
                {c.refundablePayments.map((p) => (
                  <option key={p.id} value={p.id}>
                    {formatCents(p.amountCents)} · {new Date(p.createdAt).toLocaleDateString()}
                  </option>
                ))}
              </Select>
            </FormField>
          )}
          <FormField label="Note to customer" className="sm:col-span-4">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>
          <div className="sm:col-span-4">
            <Alert>{errorText(resolve.error)}</Alert>
            <Button
              className="mt-2"
              loading={resolve.isPending}
              disabled={note.trim().length < 3 || (outcome !== "denied" && !parseDollars(amount))}
              onClick={() => resolve.mutate({ claimId: c.id, outcome, amountCents: outcome === "denied" ? null : parseDollars(amount), paymentId: outcome === "refund" ? paymentId : null, note })}
            >
              Resolve and notify customer
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-3 border-t border-slate-100 pt-2 text-sm text-slate-600">
          {c.resolution} {c.amountCents ? formatCents(c.amountCents) : ""} · {c.resolutionNote}
        </p>
      )}
    </Card>
  );
}
