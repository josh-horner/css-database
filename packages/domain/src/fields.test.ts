import { describe, expect, it } from "vitest";
import { assembleWizard, isSignerField, labelFor, mergeFields, normalizePhone, validateAnswers, type FieldDef } from "./fields";

const f = (key: string, type: FieldDef["type"], extra: Partial<FieldDef> = {}): FieldDef => ({
  key,
  type,
  label: key,
  required: true,
  sortOrder: 0,
  config: {},
  ...extra,
});

const storage = {
  id: "s1",
  name: "Summer storage",
  fields: [
    f("school", "school"),
    f("residence", "residence", { sortOrder: 1 }),
    f("student", "person", { sortOrder: 2, config: { role: "student" } }),
    f("guardian", "person", { sortOrder: 3, config: { role: "guardian" } }),
    f("pickup", "appointment", { sortOrder: 4, config: { appointmentType: "pickup", scheduling: "service_days" } }),
  ],
};
const ikea = {
  id: "s2",
  name: "IKEA delivery",
  fields: [f("customer", "person", { config: { role: "customer" } }), f("delivery_address", "address", { sortOrder: 1 }), f("delivery", "appointment", { sortOrder: 2, config: { appointmentType: "delivery", scheduling: "customer_date" } })],
};
const shipping = { id: "s3", name: "Shipping", fields: [f("student", "person", { required: false, config: { role: "student" } }), f("boxes", "number", { config: { min: 1, rateCardCode: "SHIP_BOX" } })] };

describe("wizard assembly", () => {
  it("asks only what the selected services collect", () => {
    const plan = assembleWizard([ikea]);
    expect(plan.steps).toEqual(["contact", "services", "people", "schedule", "review", "done"]);
    expect(plan.fieldsByStep.school).toBeUndefined();
  });

  it("asks a shared field once, required if any service requires it", () => {
    const merged = mergeFields([shipping, storage]);
    const student = merged.filter((m) => m.key === "student");
    expect(student).toHaveLength(1);
    expect(student[0]!.required).toBe(true);
    expect(student[0]!.serviceIds).toEqual(["s3", "s1"]);
  });

  it("student storage gets school, people, pickup steps", () => {
    expect(assembleWizard([storage]).steps).toEqual(["contact", "services", "school", "people", "schedule", "review", "done"]);
  });
});

describe("answer validation", () => {
  it("requires required fields unless staff", () => {
    const fields = [f("boxes", "number", { config: { min: 1 } })];
    expect(validateAnswers(fields, {})).toEqual({ boxes: "Required" });
    expect(validateAnswers(fields, {}, { staffMode: true })).toEqual({});
    expect(validateAnswers(fields, { boxes: 0 }, { staffMode: true })).toEqual({ boxes: "At least 1" });
  });

  it("validates person contacts", () => {
    const fields = [f("guardian", "person", { config: { role: "guardian" } })];
    expect(validateAnswers(fields, { guardian: { firstName: "Pat", lastName: "Doe" } })).toEqual({ guardian: "Email is required" });
    expect(validateAnswers(fields, { guardian: { firstName: "Pat", lastName: "Doe", email: "pat@example.com", phone: "123" } })).toEqual({
      guardian: "Enter a 10-digit phone number",
    });
    expect(validateAnswers(fields, { guardian: { firstName: "Pat", lastName: "Doe", email: "pat@example.com", phone: "(303) 555-0199" } })).toEqual({});
  });

  it("skips hidden fields", () => {
    const fields = [f("has_car", "yes_no"), f("plate", "text", { showIf: { key: "has_car", equals: true } })];
    expect(validateAnswers(fields, { has_car: false })).toEqual({});
    expect(validateAnswers(fields, { has_car: true })).toEqual({ plate: "Required" });
  });

  it("checks select options", () => {
    const fields = [f("size", "select", { config: { options: [{ value: "s", label: "Small" }] } })];
    expect(validateAnswers(fields, { size: "xl" })).toEqual({ size: "Choose an option" });
  });

  it("normalizes US phones", () => {
    expect(normalizePhone("303.555.0199")).toBe("+13035550199");
    expect(normalizePhone("1 (303) 555-0199")).toBe("+13035550199");
    expect(normalizePhone("555-0199")).toBeNull();
  });
});

describe("wording for the signer", () => {
  const residence = f("residence", "residence", { label: "Where do you live?", config: { parentLabel: "Where does your student live?" } });
  const student = f("student", "person", { label: "Student", config: { role: "student" } });
  const guardian = f("guardian", "person", { label: "Parent or guardian", config: { role: "guardian" } });
  it("speaks to a parent about their student", () => {
    expect(labelFor(residence, "guardian")).toBe("Where does your student live?");
    expect(labelFor(student, "guardian")).toBe("Your student");
    expect(labelFor(guardian, "guardian")).toBe("You (parent or guardian)");
    expect(isSignerField(guardian, "guardian")).toBe(true);
  });
  it("speaks to a student directly", () => {
    expect(labelFor(residence, "student")).toBe("Where do you live?");
    expect(labelFor(student, "student")).toBe("You (the student)");
    expect(labelFor(guardian, "student")).toBe("Parent or guardian");
    expect(isSignerField(f("customer", "person", { config: { role: "customer" } }), "student")).toBe(true);
  });
});
