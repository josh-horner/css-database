"use client";
/** Staff-created booking (phone signups): same questions as the customer wizard, nothing required, no card needed. */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cx } from "@css/ui";
import { Alert, Button, Card, Checkbox, Select, errorText } from "@css/ui/kit";
import { useTRPC } from "@css/ui/trpc";
import { PageHeader } from "../../../../components/page";
import { StaffFields } from "../../../../components/service-form";

export default function NewBooking() {
  const trpc = useTRPC();
  const router = useRouter();
  const lookups = useQuery(trpc.admin.bookings.lookups.queryOptions()).data;
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [seasonId, setSeasonId] = useState("");
  const [notify, setNotify] = useState(true);
  const create = useMutation(trpc.admin.bookings.create.mutationOptions({ onSuccess: (r) => router.push(`/bookings/${r.bookingId}`) }));
  const services = (lookups?.services ?? []).filter((s) => serviceIds.includes(s.id));
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title="New booking" subtitle="For phone or walk-in signups. Answers aren't required; the deposit goes on the open bill until the payer adds a card." />
      <Card title="Services">
        <div className="grid gap-2 sm:grid-cols-2">
          {lookups?.services
            .filter((s) => s.active)
            .map((s) => {
              const on = serviceIds.includes(s.id);
              return (
                <button
                  key={s.id}
                  onClick={() => setServiceIds(on ? serviceIds.filter((x) => x !== s.id) : [...serviceIds, s.id])}
                  className={cx("rounded-md border px-3 py-2 text-left text-sm", on ? "border-brand bg-brand/10 font-medium" : "border-slate-300")}
                >
                  {s.name}
                  {s.staffOnly && <span className="ml-1 text-xs text-slate-500">(staff only)</span>}
                </button>
              );
            })}
        </div>
        <div className="mt-3 max-w-xs">
          <Select value={seasonId} onChange={(e) => setSeasonId(e.target.value)}>
            <option value="">Season: from the service</option>
            {lookups?.seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
      </Card>
      {services.length > 0 && lookups && (
        <Card title="Details">
          <StaffFields services={services} answers={answers} setAnswers={setAnswers} schools={lookups.schools} schoolId={null} seasonId={seasonId || null} />
        </Card>
      )}
      <Checkbox checked={notify} onChange={setNotify} label="Email the confirmation to the people on the booking" />
      <Alert>{errorText(create.error)}</Alert>
      <Button size="lg" disabled={!services.length} loading={create.isPending} onClick={() => create.mutate({ serviceIds, answers, seasonId: seasonId || null, notify })}>
        Create booking
      </Button>
    </div>
  );
}
