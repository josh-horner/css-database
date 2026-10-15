"use client";
/**
 * Renders an owner-configured service field (docs/domain-model.md#service-fields-owner-configured). The same
 * component drives the customer wizard, staff "Add service", and new bookings, so a field type behaves the
 * same everywhere.
 */
import { isSignerField, type AppointmentAnswer, type FieldDef, type PersonAnswer, type ResidenceAnswer, type SignerRole } from "@css/domain";
import { cx } from "./cx";
import { Checkbox, FormField, Input, Select, Textarea, formatDate } from "./kit";

export interface SchoolOption {
  id: string;
  name: string;
  shortName: string;
  color: string;
  allowsSpecialPickup?: boolean;
  residences: { id: string; name: string; kind: "dorm" | "greek" | "off_campus" }[];
}

export interface SlotOption {
  id: string;
  date: string;
  windowId: string | null;
  label: string;
  remaining: number;
  capacity: number;
  blocked: boolean;
  campusScope: string;
}

export interface FieldContext {
  schools: SchoolOption[];
  /** The school answered in this form (for residence and pickup pickers). */
  schoolId: string | null;
  /** Windows for appointment fields that use capacity (by field key). */
  slots?: Record<string, { loading: boolean; slots: SlotOption[]; allowsSpecial?: boolean } | undefined>;
  staff?: boolean;
  /** Earliest date customers can request (lead time). */
  minDate?: string;
  /** Who is filling the form out, so person fields can say "you" vs. "them". */
  signerRole?: SignerRole | null;
}

export const SMS_CONSENT_COPY = "CSS can text me updates";
export const SMS_CONSENT_HELP = "Pickup reminders, on-my-way texts, and receipts. Msg & data rates may apply. Reply STOP to opt out.";

export function FieldInput({
  field,
  value,
  onChange,
  error,
  ctx,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  error?: string | null;
  ctx: FieldContext;
}) {
  const id = `f-${field.key}`;
  const label = (
    <>
      {field.label}
      {!field.required && <span className="ml-1 font-normal text-slate-400">(optional)</span>}
    </>
  );
  switch (field.type) {
    case "text":
      return (
        <FormField label={label} help={field.help} error={error} htmlFor={id}>
          <Input id={id} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} invalid={!!error} />
        </FormField>
      );
    case "long_text":
      return (
        <FormField label={label} help={field.help} error={error} htmlFor={id}>
          <Textarea id={id} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} invalid={!!error} />
        </FormField>
      );
    case "address":
      return (
        <FormField label={label} help={field.help ?? "Street, city, state, ZIP"} error={error} htmlFor={id}>
          <Input id={id} autoComplete="street-address" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} invalid={!!error} />
        </FormField>
      );
    case "number":
      return (
        <FormField label={label} help={field.help} error={error} htmlFor={id}>
          <Input
            id={id}
            type="number"
            inputMode="numeric"
            className="max-w-32"
            min={field.config.min}
            max={field.config.max}
            value={typeof value === "number" ? value : ""}
            onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
            invalid={!!error}
          />
        </FormField>
      );
    case "date":
      return (
        <FormField label={label} help={field.help} error={error} htmlFor={id}>
          <Input id={id} type="date" className="max-w-48" min={ctx.staff ? undefined : ctx.minDate} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} invalid={!!error} />
        </FormField>
      );
    case "yes_no":
      return (
        <FormField label={label} help={field.help} error={error}>
          <div className="flex gap-2">
            {[true, false].map((v) => (
              <button
                key={String(v)}
                type="button"
                onClick={() => onChange(v)}
                className={cx("rounded-md border px-4 py-2 text-sm", value === v ? "border-brand bg-brand/10 font-medium text-brand" : "border-slate-300 bg-white")}
              >
                {v ? "Yes" : "No"}
              </button>
            ))}
          </div>
        </FormField>
      );
    case "select":
      return (
        <FormField label={label} help={field.help} error={error}>
          <div className="grid gap-2 sm:grid-cols-2">
            {(field.config.options ?? []).map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => onChange(o.value)}
                className={cx("rounded-md border px-3 py-2 text-left text-sm", value === o.value ? "border-brand bg-brand/10 font-medium text-brand" : "border-slate-300 bg-white hover:border-slate-400")}
              >
                {o.label}
              </button>
            ))}
          </div>
        </FormField>
      );
    case "multi_select": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <FormField label={label} help={field.help} error={error}>
          <div className="space-y-1.5">
            {(field.config.options ?? []).map((o) => (
              <Checkbox
                key={o.value}
                label={o.label}
                checked={selected.includes(o.value)}
                onChange={(on) => onChange(on ? [...selected, o.value] : selected.filter((v) => v !== o.value))}
              />
            ))}
          </div>
        </FormField>
      );
    }
    case "school":
      return (
        <FormField label={label} help={field.help} error={error}>
          <div className="grid gap-2 sm:grid-cols-2">
            {ctx.schools.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onChange(s.id)}
                className={cx(
                  "flex items-center gap-3 rounded-lg border px-3 py-3 text-left text-sm",
                  value === s.id ? "border-brand bg-brand/5 ring-2 ring-brand/30" : "border-slate-300 bg-white hover:border-slate-400",
                )}
              >
                <span className="h-6 w-6 shrink-0 rounded-full border border-black/10" style={{ background: s.color }} />
                <span>
                  <span className="block font-medium">{s.shortName}</span>
                  <span className="block text-xs text-slate-500">{s.name}</span>
                </span>
              </button>
            ))}
          </div>
        </FormField>
      );
    case "residence":
      return <ResidenceInput field={field} value={value as ResidenceAnswer | undefined} onChange={onChange} error={error} ctx={ctx} label={label} />;
    case "person":
      return <PersonInput field={field} value={value as PersonAnswer | undefined} onChange={onChange} error={error} ctx={ctx} label={label} />;
    case "appointment":
      return <AppointmentInput field={field} value={value as AppointmentAnswer | undefined} onChange={onChange} error={error} ctx={ctx} label={label} />;
  }
}

function ResidenceInput({ field, value, onChange, error, ctx, label }: { field: FieldDef; value?: ResidenceAnswer; onChange: (v: unknown) => void; error?: string | null; ctx: FieldContext; label: React.ReactNode }) {
  const school = ctx.schools.find((s) => s.id === ctx.schoolId);
  if (!school) return <FormField label={label} help="Pick your school first." error={error}>{null}</FormField>;
  const residence = school.residences.find((r) => r.id === value?.residenceId);
  const groups = [
    { kind: "dorm", title: "Residence halls" },
    { kind: "greek", title: "Greek houses" },
    { kind: "off_campus", title: "Off campus" },
  ] as const;
  return (
    <div className="space-y-3">
      <FormField label={label} help={field.help} error={error && !residence ? error : null} htmlFor={`f-${field.key}`}>
        <Select id={`f-${field.key}`} value={value?.residenceId ?? ""} onChange={(e) => onChange({ residenceId: e.target.value, room: value?.room, address: value?.address })} invalid={!!error && !residence}>
          <option value="">Choose…</option>
          {groups.map((g) => {
            const list = school.residences.filter((r) => r.kind === g.kind);
            return list.length ? (
              <optgroup key={g.kind} label={g.title}>
                {list.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </optgroup>
            ) : null;
          })}
        </Select>
      </FormField>
      {residence && residence.kind === "dorm" && (
        <FormField label="Room number" error={error && residence ? error : null} htmlFor={`f-${field.key}-room`}>
          <Input id={`f-${field.key}-room`} className="max-w-40" value={value?.room ?? ""} onChange={(e) => onChange({ ...value, room: e.target.value })} invalid={!!error} />
        </FormField>
      )}
      {residence && residence.kind !== "dorm" && (
        <>
          <FormField label="Street address" help="Including apartment or unit" error={error && residence ? error : null} htmlFor={`f-${field.key}-addr`}>
            <Input id={`f-${field.key}-addr`} autoComplete="street-address" value={value?.address ?? ""} onChange={(e) => onChange({ ...value, address: e.target.value })} invalid={!!error} />
          </FormField>
          <FormField label="Unit / room (optional)" htmlFor={`f-${field.key}-room2`}>
            <Input id={`f-${field.key}-room2`} className="max-w-40" value={value?.room ?? ""} onChange={(e) => onChange({ ...value, room: e.target.value })} />
          </FormField>
        </>
      )}
    </div>
  );
}

function PersonInput({ field, value, onChange, error, ctx, label }: { field: FieldDef; value?: PersonAnswer; onChange: (v: unknown) => void; error?: string | null; ctx: FieldContext; label: React.ReactNode }) {
  const v: PersonAnswer = value ?? { firstName: "", lastName: "" };
  const set = (patch: Partial<PersonAnswer>) => onChange({ ...v, ...patch });
  const k = field.key;
  // Staff enter other people's details; in signup, only the signer's own section is "me".
  const self = !ctx.staff && isSignerField(field, ctx.signerRole);
  const name = v.firstName.trim() || "them";
  return (
    <fieldset className="space-y-3 rounded-lg border border-slate-200 p-3">
      <legend className="px-1 text-sm font-semibold text-slate-800">{label}</legend>
      {field.help && !self && <p className="-mt-1 text-xs text-slate-500">{field.help}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="First name" htmlFor={`${k}-first`}>
          <Input id={`${k}-first`} autoComplete="off" value={v.firstName} onChange={(e) => set({ firstName: e.target.value })} />
        </FormField>
        <FormField label="Last name" htmlFor={`${k}-last`}>
          <Input id={`${k}-last`} autoComplete="off" value={v.lastName} onChange={(e) => set({ lastName: e.target.value })} />
        </FormField>
        <FormField label={field.config.role === "student" && !ctx.staff ? "Email (optional)" : "Email"} htmlFor={`${k}-email`}>
          <Input id={`${k}-email`} type="email" inputMode="email" autoComplete="off" value={v.email ?? ""} onChange={(e) => set({ email: e.target.value })} />
        </FormField>
        <FormField label={field.config.askPhone ? "Mobile phone" : "Mobile phone (optional)"} htmlFor={`${k}-phone`}>
          <Input id={`${k}-phone`} type="tel" inputMode="tel" autoComplete="off" value={v.phone ?? ""} onChange={(e) => set({ phone: e.target.value })} />
        </FormField>
      </div>
      {!!v.phone?.trim() && (
        <Checkbox
          checked={!!v.smsConsent}
          onChange={(on) => set({ smsConsent: on })}
          label={self || ctx.signerRole == null ? SMS_CONSENT_COPY : `CSS can text ${name} updates`}
          help={self || ctx.signerRole == null ? SMS_CONSENT_HELP : `Only check this if ${name === "them" ? "they" : name} agreed. ${SMS_CONSENT_HELP}`}
        />
      )}
      {error && <p className="text-xs font-medium text-red-600">{error}</p>}
    </fieldset>
  );
}

function AppointmentInput({ field, value, onChange, error, ctx, label }: { field: FieldDef; value?: AppointmentAnswer; onChange: (v: unknown) => void; error?: string | null; ctx: FieldContext; label: React.ReactNode }) {
  if (field.config.scheduling !== "service_days") {
    return (
      <FormField label={label} help={field.help ?? "We'll confirm the exact time with you."} error={error} htmlFor={`f-${field.key}`}>
        <Input
          id={`f-${field.key}`}
          type="date"
          className="max-w-48"
          min={ctx.staff ? undefined : ctx.minDate}
          value={value?.date ?? ""}
          onChange={(e) => onChange({ date: e.target.value, windowId: null, serviceDayId: null })}
          invalid={!!error}
        />
      </FormField>
    );
  }
  const source = ctx.slots?.[field.key];
  const byDate = new Map<string, SlotOption[]>();
  for (const s of source?.slots ?? []) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
  return (
    <FormField label={label} help={field.help} error={error}>
      {!ctx.schoolId && <p className="text-sm text-slate-500">Pick your school first.</p>}
      {source?.loading && <p className="text-sm text-slate-500">Loading days…</p>}
      {ctx.schoolId && !source?.loading && byDate.size === 0 && !value?.special && (
        <p className="text-sm text-slate-600">No pickup days are open right now. {source?.allowsSpecial ? "You can request a special pickup below." : "Check back soon or contact us."}</p>
      )}
      <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
        {[...byDate.entries()].map(([date, slots]) => (
          <div key={date} className="flex flex-wrap items-center gap-2">
            <div className="w-28 shrink-0 text-sm font-medium text-slate-700">{formatDate(date)}</div>
            {slots.map((s) => {
              const selected = value?.serviceDayId === s.id;
              const full = s.remaining <= 0 || s.blocked;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onChange({ date: s.date, windowId: s.windowId, serviceDayId: s.id })}
                  className={cx(
                    "rounded-md border px-3 py-1.5 text-xs",
                    selected ? "border-brand bg-brand text-white" : full ? "border-red-200 bg-red-50 text-red-700" : "border-slate-300 bg-white hover:border-brand",
                  )}
                >
                  {s.windowId ? s.label : "Any time that day"}
                  {ctx.staff ? ` · ${s.capacity - s.remaining}/${s.capacity}${s.blocked ? " · closed" : ""}` : s.remaining <= 3 ? ` · ${s.remaining} left` : ""}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {(source?.allowsSpecial || ctx.staff) && (
        <div className="mt-2 space-y-2 rounded-md bg-slate-50 p-2">
          <Checkbox
            checked={!!value?.special}
            onChange={(on) => onChange(on ? { date: "", windowId: null, serviceDayId: null, special: true } : undefined)}
            label="None of these work: request a special pickup"
            help="A paid pickup outside the scheduled days. We'll confirm the time."
          />
          {value?.special && (
            <Input type="date" className="max-w-48" min={ctx.minDate} value={value.date} onChange={(e) => onChange({ ...value, date: e.target.value })} />
          )}
        </div>
      )}
    </FormField>
  );
}
