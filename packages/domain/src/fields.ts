/**
 * Service fields (docs/domain-model.md#service-fields-owner-configured).
 * We own the field types; the owner composes services from them in admin. The signup wizard is assembled
 * from the union of the selected services' fields, so nothing is asked that no selected service needs.
 */
import { z } from "zod";

export const FIELD_TYPES = [
  "text",
  "long_text",
  "number",
  "yes_no",
  "select",
  "multi_select",
  "date",
  "person",
  "school",
  "residence",
  "address",
  "appointment",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const PERSON_ROLES = ["student", "guardian", "customer"] as const;
export type PersonRole = (typeof PERSON_ROLES)[number];

export const FIELD_TYPE_INFO: Record<FieldType, { label: string; kind: "primitive" | "reference" | "appointment"; help: string }> = {
  text: { label: "Short text", kind: "primitive", help: "One line of text" },
  long_text: { label: "Long text", kind: "primitive", help: "A paragraph, e.g. special instructions" },
  number: { label: "Number", kind: "primitive", help: "Optionally priced per unit from the rate card" },
  yes_no: { label: "Yes / no", kind: "primitive", help: "Optionally adds a rate card charge when yes" },
  select: { label: "Choose one", kind: "primitive", help: "Options you type in; each can carry a rate card price" },
  multi_select: { label: "Choose several", kind: "primitive", help: "Options you type in; each can carry a rate card price" },
  date: { label: "Date", kind: "primitive", help: "A calendar date" },
  person: { label: "Person", kind: "reference", help: "Student, parent/guardian, or customer, with email, phone, and text consent" },
  school: { label: "School", kind: "reference", help: "One of your active schools" },
  residence: { label: "Residence", kind: "reference", help: "Dorm, Greek house, or off-campus address at the chosen school" },
  address: { label: "Address", kind: "reference", help: "A street address (non-student services)" },
  appointment: { label: "Appointment", kind: "appointment", help: "Pickup/delivery from the school's capacity windows, or a requested date" },
};

export const SelectOption = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
  rateCardCode: z.string().nullish(),
});
export type SelectOption = z.infer<typeof SelectOption>;

export const FieldConfig = z.object({
  options: z.array(SelectOption).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  /** number: quantity × this item; yes_no: charged once when yes. */
  rateCardCode: z.string().nullish(),
  role: z.enum(PERSON_ROLES).optional(),
  askPhone: z.boolean().optional(),
  appointmentType: z.enum(["pickup", "delivery", "move", "service"]).optional(),
  scheduling: z.enum(["service_days", "customer_date"]).optional(),
  /** appointment: which address answer it happens at; defaults to the residence, then the first address. */
  addressKey: z.string().nullish(),
  /** How to ask it when a parent is filling the form out for their student, e.g. "Where does your student live?". */
  parentLabel: z.string().nullish(),
});
export type FieldConfig = z.infer<typeof FieldConfig>;

export interface FieldDef {
  key: string;
  type: FieldType;
  label: string;
  help?: string | null;
  required: boolean;
  sortOrder: number;
  config: FieldConfig;
  showIf?: { key: string; equals: unknown } | null;
}

// ---------------------------------------------------------------------------------------------
// Answer shapes per type

const trimmed = (max: number) => z.string().trim().max(max);
export const PersonAnswer = z.object({
  firstName: trimmed(80).min(1, "First name is required"),
  lastName: trimmed(80).min(1, "Last name is required"),
  email: z.string().trim().toLowerCase().email("Enter a valid email").or(z.literal("")).optional(),
  phone: z.string().trim().max(30).optional(),
  smsConsent: z.boolean().optional(),
});
export type PersonAnswer = z.infer<typeof PersonAnswer>;

export const ResidenceAnswer = z.object({
  residenceId: z.string().uuid(),
  room: trimmed(40).optional(),
  /** Street address when the residence is off campus. */
  address: trimmed(200).optional(),
});
export type ResidenceAnswer = z.infer<typeof ResidenceAnswer>;

export const AppointmentAnswer = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  windowId: z.string().nullish(),
  serviceDayId: z.string().uuid().nullish(),
  /** Customer asked for a paid special pickup outside the calendar. */
  special: z.boolean().optional(),
});
export type AppointmentAnswer = z.infer<typeof AppointmentAnswer>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function answerSchema(field: FieldDef): z.ZodType {
  switch (field.type) {
    case "text":
      return trimmed(200).min(1, "Required");
    case "long_text":
      return trimmed(2000).min(1, "Required");
    case "number": {
      let n = z.number({ error: "Enter a number" }).int("Whole numbers only");
      if (field.config.min !== undefined) n = n.min(field.config.min, `At least ${field.config.min}`);
      if (field.config.max !== undefined) n = n.max(field.config.max, `At most ${field.config.max}`);
      return n;
    }
    case "yes_no":
      return z.boolean();
    case "select": {
      const values = (field.config.options ?? []).map((o) => o.value);
      return z.string().refine((v) => values.includes(v), "Choose an option");
    }
    case "multi_select": {
      const values = (field.config.options ?? []).map((o) => o.value);
      return z.array(z.string().refine((v) => values.includes(v))).min(1, "Choose at least one");
    }
    case "date":
      return z.string().regex(ISO_DATE, "Pick a date");
    case "person":
      return PersonAnswer;
    case "school":
      return z.string().uuid("Choose a school");
    case "residence":
      return ResidenceAnswer;
    case "address":
      return trimmed(200).min(5, "Enter the full address");
    case "appointment":
      return AppointmentAnswer;
  }
}

export function isEmptyAnswer(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export function isVisible(field: Pick<FieldDef, "showIf">, answers: Record<string, unknown>): boolean {
  if (!field.showIf) return true;
  return answers[field.showIf.key] === field.showIf.equals;
}

/**
 * Validates answers for the given fields. Staff mode skips "required" (legacy admin_editing) but still
 * rejects malformed values. Returns field key → message.
 */
export function validateAnswers(
  fields: readonly FieldDef[],
  answers: Record<string, unknown>,
  opts: { staffMode?: boolean } = {},
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    if (!isVisible(field, answers)) continue;
    const value = answers[field.key];
    if (isEmptyAnswer(value)) {
      if (field.required && !opts.staffMode) errors[field.key] = "Required";
      continue;
    }
    const result = answerSchema(field).safeParse(value);
    if (!result.success) {
      errors[field.key] = result.error.issues[0]?.message ?? "Invalid";
      continue;
    }
    if (field.type === "person") {
      const p = result.data as PersonAnswer;
      if (!opts.staffMode && !p.email && field.config.role !== "student") errors[field.key] = "Email is required";
      if (p.phone && !normalizePhone(p.phone)) errors[field.key] = "Enter a 10-digit phone number";
      if (field.config.askPhone && !p.phone && !opts.staffMode) errors[field.key] = "Phone is required";
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------------------------
// Wizard assembly

export const WIZARD_STEPS = ["contact", "services", "school", "people", "schedule", "details", "review", "done"] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export const STEP_TITLES: Record<WizardStep, string> = {
  contact: "Start",
  services: "Services",
  school: "School",
  people: "People",
  schedule: "Pickup",
  details: "Details",
  review: "Review & pay",
  done: "Done",
};

export function stepForField(type: FieldType): WizardStep {
  switch (type) {
    case "school":
    case "residence":
      return "school";
    case "person":
      return "people";
    case "appointment":
    case "address":
      return "schedule";
    default:
      return "details";
  }
}

export interface ServiceWithFields {
  id: string;
  name: string;
  fields: readonly FieldDef[];
}

export interface MergedField extends FieldDef {
  serviceIds: string[];
}

/** One question per key across all selected services, in service then field order. */
export function mergeFields(services: readonly ServiceWithFields[]): MergedField[] {
  const byKey = new Map<string, MergedField>();
  for (const service of services) {
    for (const field of [...service.fields].sort((a, b) => a.sortOrder - b.sortOrder)) {
      const existing = byKey.get(field.key);
      if (existing) {
        existing.serviceIds.push(service.id);
        existing.required ||= field.required;
        continue;
      }
      byKey.set(field.key, { ...field, serviceIds: [service.id] });
    }
  }
  return [...byKey.values()];
}

export interface WizardPlan {
  steps: WizardStep[];
  fieldsByStep: Partial<Record<WizardStep, MergedField[]>>;
}

export function assembleWizard(services: readonly ServiceWithFields[]): WizardPlan {
  const merged = mergeFields(services);
  const fieldsByStep: Partial<Record<WizardStep, MergedField[]>> = {};
  for (const field of merged) {
    const step = stepForField(field.type);
    (fieldsByStep[step] ??= []).push(field);
  }
  const steps = WIZARD_STEPS.filter(
    (s) => s === "contact" || s === "services" || s === "review" || s === "done" || (fieldsByStep[s]?.length ?? 0) > 0,
  );
  return { steps, fieldsByStep };
}

/** Schedule step title depends on what's being scheduled. */
export function scheduleTitle(fields: readonly MergedField[] | undefined): string {
  const types = new Set((fields ?? []).filter((f) => f.type === "appointment").map((f) => f.config.appointmentType));
  if (types.size === 1 && types.has("pickup")) return "Pickup";
  if (types.size === 1 && types.has("delivery")) return "Delivery";
  return "Scheduling";
}

export function stepIndex(step: string): number {
  return WIZARD_STEPS.indexOf(step as WizardStep);
}

/** Furthest of two steps (stepReached never goes backwards). */
export function furthestStep(a: string, b: string): WizardStep {
  return (stepIndex(a) >= stepIndex(b) ? a : b) as WizardStep;
}

// ---------------------------------------------------------------------------------------------
// Wording for whoever is filling the form out

export type SignerRole = "student" | "guardian" | "other";

/**
 * The question as the person filling out the form should read it. Person fields follow from roles ("You",
 * "Your student"); other fields use the owner's parent wording when a parent is signing up.
 */
export function labelFor(field: Pick<FieldDef, "type" | "label" | "config">, signer: SignerRole | null | undefined): string {
  if (!signer) return field.label;
  if (field.type === "person") {
    const role = field.config.role ?? "customer";
    if (signer === "student" && role === "student") return "You (the student)";
    if (signer === "guardian" && role === "guardian") return "You (parent or guardian)";
    if (signer === "guardian" && role === "student") return "Your student";
    if (signer !== "guardian" && role === "customer") return "You";
    return field.label;
  }
  return signer === "guardian" && field.config.parentLabel ? field.config.parentLabel : field.label;
}

/** Whether a person field is the signer themself (their email from step 1 goes there). */
export function isSignerField(field: Pick<FieldDef, "type" | "config">, signer: SignerRole | null | undefined): boolean {
  if (field.type !== "person" || !signer) return false;
  const role = field.config.role ?? "customer";
  return role === signer || (role === "customer" && signer !== "guardian");
}

// ---------------------------------------------------------------------------------------------
// Contacts

export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function formatPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}
