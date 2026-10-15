"use client";
/** Staff form for a set of services' fields (Add service, New booking): same field renderer as signup, staff mode. */
import { useQueries } from "@tanstack/react-query";
import { mergeFields, type FieldDef, type MergedField } from "@css/domain";
import { FieldInput, type FieldContext, type SchoolOption } from "@css/ui/fields";
import { useTRPC } from "@css/ui/trpc";

export function StaffFields({
  services,
  answers,
  setAnswers,
  schools,
  schoolId,
  bookingId,
  seasonId,
  errors = {},
  hideKeys = [],
}: {
  services: { id: string; name: string; fields: FieldDef[] }[];
  answers: Record<string, unknown>;
  setAnswers: (a: Record<string, unknown>) => void;
  schools: SchoolOption[];
  schoolId: string | null;
  bookingId?: string;
  seasonId?: string | null;
  errors?: Record<string, string>;
  hideKeys?: string[];
}) {
  const trpc = useTRPC();
  const fields = mergeFields(services).filter((f) => !hideKeys.includes(f.key));
  const schoolField = fields.find((f) => f.type === "school");
  const effectiveSchool = (schoolField ? (answers[schoolField.key] as string | undefined) : undefined) ?? schoolId;
  const slotFields = fields.filter((f) => f.type === "appointment" && f.config.scheduling === "service_days");
  const results = useQueries({
    queries: slotFields.map((f) => {
      const type = f.config.appointmentType === "delivery" ? ("delivery" as const) : ("pickup" as const);
      return bookingId
        ? trpc.admin.bookings.slots.queryOptions({ bookingId, type })
        : trpc.admin.bookings.schoolSlots.queryOptions({ schoolId: effectiveSchool ?? "", seasonId: seasonId ?? null, type }, { enabled: !!effectiveSchool });
    }),
  });
  const ctx: FieldContext = {
    schools,
    schoolId: effectiveSchool ?? null,
    staff: true,
    slots: Object.fromEntries(slotFields.map((f, i) => [f.key, { loading: results[i]!.isLoading, slots: results[i]!.data ?? [], allowsSpecial: true }])),
  };
  return (
    <div className="space-y-4">
      {fields.map((f: MergedField) => (
        <FieldInput key={f.key} field={f} value={answers[f.key]} onChange={(v) => setAnswers({ ...answers, [f.key]: v })} error={errors[f.key]} ctx={ctx} />
      ))}
      {fields.length === 0 && <p className="text-sm text-slate-500">This service has no questions.</p>}
    </div>
  );
}
