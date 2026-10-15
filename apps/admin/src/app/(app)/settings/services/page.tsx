"use client";
/**
 * Service builder (docs/domain-model.md#service-fields-owner-configured): we own the field types; the owner composes
 * services from them, sets when each is offered and what replaces it, and previews the signup form.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { FIELD_TYPE_INFO, FIELD_TYPES, type FieldConfig, type FieldDef, type FieldType } from "@css/domain";
import { cx, formatCents } from "@css/ui";
import { FieldInput, type FieldContext } from "@css/ui/fields";
import { Alert, Badge, Button, Card, Checkbox, FormField, Input, Modal, Select, Tabs, Textarea, errorText } from "@css/ui/kit";
import { useTRPC } from "@css/ui/trpc";
import { PageHeader } from "../../../../components/page";
import type { Out } from "../../../../components/types";

type Service = Out["admin"]["config"]["services"][number];
type FieldRow = Service["fields"][number];

const toLocalInput = (d: Date | string | null) => {
  if (!d) return "";
  const x = new Date(d);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(x);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour") === "24" ? "00" : g("hour")}:${g("minute")}`;
};
/** Interprets a datetime-local value as Denver time. */
const fromLocalInput = (v: string) => {
  if (!v) return null;
  const guess = new Date(`${v}:00Z`);
  const offset = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" })).getTime() - new Date(guess.toLocaleString("en-US", { timeZone: "America/Denver" })).getTime();
  return new Date(guess.getTime() + offset);
};

export default function ServicesPage() {
  const trpc = useTRPC();
  const services = useQuery(trpc.admin.config.services.queryOptions()).data;
  const [selected, setSelected] = useState<string | "new" | null>(null);
  const [tab, setTab] = useState<"list" | "timeline">("list");
  const current = services?.find((s) => s.id === selected);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Services"
        subtitle="What customers can sign up for, when, and what each one asks. Changes apply to new signups; existing bookings keep their answers."
        actions={<Button onClick={() => setSelected("new")}>New service</Button>}
      />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "list", label: "Services" }, { id: "timeline", label: "Year timeline" }]} />
      {tab === "timeline" && services && <Timeline services={services} onPick={(id) => (setSelected(id), setTab("list"))} />}
      {tab === "list" && (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <ul className="space-y-1">
            {services?.map((s) => (
              <li key={s.id}>
                <button onClick={() => setSelected(s.id)} className={cx("w-full rounded-lg border px-3 py-2 text-left", selected === s.id ? "border-brand bg-brand/5" : "border-slate-200 bg-white hover:border-slate-300")}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={cx("font-medium", !s.active && "text-slate-400 line-through")}>{s.name}</span>
                    <OfferedBadge s={s} />
                  </div>
                  <div className="text-xs text-slate-500">
                    {s.family ?? "—"} · {s.fields.filter((f) => f.active).length} questions · {s.bookings} bookings
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <div>
            {selected === "new" && <ServiceEditor key="new" service={null} all={services ?? []} onSaved={setSelected} />}
            {current && <ServiceEditor key={current.id} service={current} all={services ?? []} onSaved={setSelected} />}
            {!selected && <p className="text-sm text-slate-500">Pick a service to edit its questions and dates.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function OfferedBadge({ s }: { s: Service }) {
  const now = new Date();
  if (!s.active) return <Badge>off</Badge>;
  if (s.staffOnly) return <Badge tone="purple">staff only</Badge>;
  if (s.offeredFrom && now < new Date(s.offeredFrom)) return <Badge tone="amber">upcoming</Badge>;
  if (s.offeredUntil && now >= new Date(s.offeredUntil)) return <Badge>ended</Badge>;
  return <Badge tone="green">offered now</Badge>;
}

function Timeline({ services, onPick }: { services: Service[]; onPick: (id: string) => void }) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const end = new Date(start.getFullYear() + 1, start.getMonth(), 1);
  const span = end.getTime() - start.getTime();
  const pos = (d: Date) => Math.min(100, Math.max(0, ((d.getTime() - start.getTime()) / span) * 100));
  const months = Array.from({ length: 12 }, (_, i) => new Date(start.getFullYear(), start.getMonth() + i, 1));
  const families = [...new Set(services.map((s) => s.family ?? "other"))];
  return (
    <Card>
      <div className="relative ml-48 h-5 text-[10px] text-slate-500">
        {months.map((m) => (
          <span key={m.toISOString()} className="absolute" style={{ left: `${pos(m)}%` }}>
            {m.toLocaleDateString("en-US", { month: "short" })}
          </span>
        ))}
      </div>
      {families.map((fam) => (
        <div key={fam} className="border-t border-slate-100 py-1">
          <div className="text-xs font-semibold uppercase text-slate-400">{fam}</div>
          {services
            .filter((s) => (s.family ?? "other") === fam)
            .map((s) => {
              const from = s.offeredFrom ? new Date(s.offeredFrom) : start;
              const until = s.offeredUntil ? new Date(s.offeredUntil) : end;
              return (
                <div key={s.id} className="flex items-center">
                  <button onClick={() => onPick(s.id)} className="w-48 truncate pr-2 text-left text-sm hover:underline">
                    {s.name}
                  </button>
                  <div className="relative h-5 flex-1 rounded bg-slate-50">
                    <div className="absolute inset-y-0 w-px bg-red-400" style={{ left: `${pos(now)}%` }} />
                    {s.active && (
                      <div
                        className={cx("absolute inset-y-1 rounded", s.staffOnly ? "bg-purple-300" : "bg-brand/60")}
                        style={{ left: `${pos(from)}%`, width: `${Math.max(0.5, pos(until) - pos(from))}%` }}
                        title={`${from.toLocaleDateString()} – ${until.toLocaleDateString()}`}
                      />
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      ))}
      <p className="mt-2 text-xs text-slate-500">Red line = now. When a service ends, drafts holding it move to its successor automatically.</p>
    </Card>
  );
}

function ServiceEditor({ service, all, onSaved }: { service: Service | null; all: Service[]; onSaved: (id: string) => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const lookups = useQuery(trpc.admin.bookings.lookups.queryOptions()).data;
  const seasonId = service?.seasonId ?? lookups?.seasons[0]?.id ?? "";
  const rateCard = useQuery(trpc.admin.config.rateCard.queryOptions({ seasonId }, { enabled: !!seasonId })).data?.items ?? [];
  const [v, setV] = useState(() => ({
    code: service?.code ?? "",
    name: service?.name ?? "",
    description: service?.description ?? "",
    family: service?.family ?? "",
    seasonId: service?.seasonId ?? "",
    offeredFrom: toLocalInput(service?.offeredFrom ?? null),
    offeredUntil: toLocalInput(service?.offeredUntil ?? null),
    successorServiceId: service?.successorServiceId ?? "",
    chargesDeposit: service?.chargesDeposit ?? false,
    baseRateCardCode: service?.baseRateCardCode ?? "",
    instructions: service?.instructions ?? "",
    staffOnly: service?.staffOnly ?? false,
    active: service?.active ?? true,
    schoolIds: service?.schools.map((s) => s.schoolId) ?? [],
  }));
  const [editing, setEditing] = useState<FieldRow | "new" | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const save = useMutation(
    trpc.admin.config.saveService.mutationOptions({
      onSuccess: (id) => {
        void qc.invalidateQueries();
        onSaved(id);
      },
    }),
  );
  const reorder = useMutation(trpc.admin.config.reorderFields.mutationOptions({ onSuccess: () => void qc.invalidateQueries() }));
  const fields = (service?.fields ?? []).filter((f) => f.active);
  const move = (i: number, dir: -1 | 1) => {
    const ids = fields.map((f) => f.id);
    const [x] = ids.splice(i, 1);
    ids.splice(i + dir, 0, x!);
    reorder.mutate({ serviceId: service!.id, fieldIds: ids });
  };
  return (
    <div className="space-y-4">
      <Card title={service ? service.name : "New service"}>
        <div className="grid gap-3 md:grid-cols-2">
          <FormField label="Name">
            <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value, code: service ? v.code : e.target.value.toUpperCase().replace(/[^A-Z0-9]+/g, "_") })} />
          </FormField>
          <FormField label="Code" help="Short internal id">
            <Input value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} />
          </FormField>
          <FormField label="Description (shown at signup)" className="md:col-span-2">
            <Textarea value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} className="min-h-14" />
          </FormField>
          <FormField label="Family" help="Groups variants on the timeline, e.g. student-storage">
            <Input value={v.family} onChange={(e) => setV({ ...v, family: e.target.value })} />
          </FormField>
          <FormField label="Season" help="Student services belong to a season; leave blank for year-round work.">
            <Select value={v.seasonId} onChange={(e) => setV({ ...v, seasonId: e.target.value })}>
              <option value="">Year-round</option>
              {lookups?.seasons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Offered from (Denver time)" help="Blank = no start">
            <Input type="datetime-local" value={v.offeredFrom} onChange={(e) => setV({ ...v, offeredFrom: e.target.value })} />
          </FormField>
          <FormField label="Offered until (Denver time)" help="Blank = no end">
            <Input type="datetime-local" value={v.offeredUntil} onChange={(e) => setV({ ...v, offeredUntil: e.target.value })} />
          </FormField>
          <FormField label="Then switch to" help="Drafts holding this service move to this one when it ends.">
            <Select value={v.successorServiceId} onChange={(e) => setV({ ...v, successorServiceId: e.target.value })}>
              <option value="">Nothing</option>
              {all
                .filter((s) => s.id !== service?.id)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </Select>
          </FormField>
          <FormField label="Charged when booked" help="A rate card item billed once (e.g. In-room pick-up $75).">
            <Select value={v.baseRateCardCode} onChange={(e) => setV({ ...v, baseRateCardCode: e.target.value })}>
              <option value="">Nothing extra</option>
              {rateCard.map((r) => (
                <option key={r.id} value={r.code}>
                  {r.name} ({formatCents(r.unitPriceCents)})
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Note shown at signup" className="md:col-span-2">
            <Input value={v.instructions} onChange={(e) => setV({ ...v, instructions: e.target.value })} />
          </FormField>
          <FormField label="Schools" help="None checked = every school." className="md:col-span-2">
            <div className="flex flex-wrap gap-3">
              {lookups?.schools.map((s) => (
                <Checkbox key={s.id} checked={v.schoolIds.includes(s.id)} onChange={(on) => setV({ ...v, schoolIds: on ? [...v.schoolIds, s.id] : v.schoolIds.filter((x) => x !== s.id) })} label={s.shortName} />
              ))}
            </div>
          </FormField>
          <div className="space-y-2 md:col-span-2">
            <Checkbox checked={v.chargesDeposit} onChange={(c) => setV({ ...v, chargesDeposit: c })} label="Charge the season's sign-up deposit" />
            <Checkbox checked={v.staffOnly} onChange={(c) => setV({ ...v, staffOnly: c })} label="Staff only (not in the customer signup)" />
            <Checkbox checked={v.active} onChange={(c) => setV({ ...v, active: c })} label="Active" />
          </div>
        </div>
        <Alert>{errorText(save.error)}</Alert>
        <div className="mt-3 flex justify-end">
          <Button
            loading={save.isPending}
            onClick={() =>
              save.mutate({
                id: service?.id ?? null,
                code: v.code,
                name: v.name,
                description: v.description || null,
                family: v.family || null,
                seasonId: v.seasonId || null,
                offeredFrom: fromLocalInput(v.offeredFrom),
                offeredUntil: fromLocalInput(v.offeredUntil),
                successorServiceId: v.successorServiceId || null,
                chargesDeposit: v.chargesDeposit,
                baseRateCardCode: v.baseRateCardCode || null,
                instructions: v.instructions || null,
                staffOnly: v.staffOnly,
                active: v.active,
                schoolIds: v.schoolIds,
              })
            }
          >
            Save service
          </Button>
        </div>
      </Card>
      {service && (
        <Card
          title="Questions"
          actions={
            <>
              <Button size="sm" variant="secondary" onClick={() => setShowPreview(true)}>
                Preview signup form
              </Button>
              <Button size="sm" onClick={() => setEditing("new")}>
                Add question
              </Button>
            </>
          }
        >
          <ol className="space-y-1">
            {fields.map((f, i) => (
              <li key={f.id} className="flex items-center gap-2 rounded-md border border-slate-200 px-2 py-1.5 text-sm">
                <div className="flex flex-col text-xs text-slate-400">
                  <button disabled={i === 0} onClick={() => move(i, -1)} className="disabled:opacity-30">
                    ▲
                  </button>
                  <button disabled={i === fields.length - 1} onClick={() => move(i, 1)} className="disabled:opacity-30">
                    ▼
                  </button>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    {f.label} {!f.required && <span className="text-xs font-normal text-slate-400">optional</span>}
                  </div>
                  <div className="text-xs text-slate-500">
                    {FIELD_TYPE_INFO[f.type as FieldType]?.label ?? f.type} · key <code>{f.key}</code> {describeConfig(f)}
                    {f.showIf && ` · only if ${f.showIf.key} = ${JSON.stringify(f.showIf.equals)}`}
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setEditing(f)}>
                  Edit
                </Button>
              </li>
            ))}
          </ol>
          {fields.length === 0 && <p className="text-sm text-slate-500">No questions yet.</p>}
        </Card>
      )}
      {editing && service && <FieldEditor service={service} field={editing === "new" ? null : editing} rateCard={rateCard} onClose={() => setEditing(null)} />}
      {showPreview && service && <Preview service={service} onClose={() => setShowPreview(false)} />}
    </div>
  );
}

function describeConfig(f: FieldRow) {
  const c = f.config as FieldConfig;
  if (f.type === "person") return `· ${c.role}${c.askPhone ? ", phone required" : ""}`;
  if (f.type === "appointment") return `· ${c.appointmentType}, ${c.scheduling === "service_days" ? "pick from capacity windows" : "customer requests a date"}`;
  if (f.type === "select" || f.type === "multi_select") return `· ${c.options?.length ?? 0} options`;
  if (c.rateCardCode) return `· priced ${c.rateCardCode}`;
  return "";
}

function FieldEditor({ service, field, rateCard, onClose }: { service: Service; field: FieldRow | null; rateCard: { code: string; name: string; unitPriceCents: number }[]; onClose: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const library = useQuery(trpc.admin.config.fieldLibrary.queryOptions()).data ?? [];
  const [type, setType] = useState<FieldType>((field?.type as FieldType) ?? "text");
  const [key, setKey] = useState(field?.key ?? "");
  const [label, setLabel] = useState(field?.label ?? "");
  const [help, setHelp] = useState(field?.help ?? "");
  const [required, setRequired] = useState(field?.required ?? true);
  const [config, setConfig] = useState<FieldConfig>((field?.config as FieldConfig) ?? {});
  const [showIf, setShowIf] = useState<{ key: string; equals: unknown } | null>(field?.showIf ?? null);
  const [keyTouched, setKeyTouched] = useState(!!field);
  useEffect(() => {
    if (!keyTouched) setKey(label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40));
  }, [label, keyTouched]);
  const done = { onSuccess: () => (void qc.invalidateQueries(), onClose()) };
  const save = useMutation(trpc.admin.config.saveField.mutationOptions(done));
  const remove = useMutation(trpc.admin.config.saveField.mutationOptions(done));
  const reuse = (k: string) => {
    const l = library.find((x) => x.key === k);
    if (!l) return;
    setType(l.type as FieldType);
    setKey(l.key);
    setKeyTouched(true);
    setLabel(l.label);
    setHelp(l.help ?? "");
    setRequired(l.required);
    setConfig(l.config as FieldConfig);
  };
  const others = service.fields.filter((f) => f.active && f.id !== field?.id);
  const payload = { id: field?.id ?? null, serviceId: service.id, key, type, label, help: help || null, required, config: config as Record<string, unknown>, showIf, active: true };
  return (
    <Modal open onClose={onClose} title={field ? `Edit "${field.label}"` : "Add a question"} wide>
      <div className="space-y-3">
        {!field && library.length > 0 && (
          <FormField label="Reuse a question other services ask" help="Same key = asked once when several services are picked, and the answer is shared.">
            <Select value="" onChange={(e) => reuse(e.target.value)}>
              <option value="">Start from scratch…</option>
              {library.map((l) => (
                <option key={l.key} value={l.key}>
                  {l.label} ({l.key}, {FIELD_TYPE_INFO[l.type as FieldType]?.label}, used by {l.usedBy})
                </option>
              ))}
            </Select>
          </FormField>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          <FormField label="Type" help={FIELD_TYPE_INFO[type].help}>
            <Select value={type} onChange={(e) => (setType(e.target.value as FieldType), setConfig({ parentLabel: config.parentLabel }))}>
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {FIELD_TYPE_INFO[t].label}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Question" htmlFor="label">
            <Input id="label" value={label} onChange={(e) => setLabel(e.target.value)} />
          </FormField>
          <FormField label="Help text (optional)">
            <Input value={help} onChange={(e) => setHelp(e.target.value)} />
          </FormField>
          <FormField label="Key" help="Stable id for answers and reports.">
            <Input value={key} onChange={(e) => (setKey(e.target.value), setKeyTouched(true))} disabled={!!field} />
          </FormField>
        </div>
        {type !== "person" && (
          <FormField label="When a parent is filling it out, ask (optional)" help={`e.g. "Where does your student live?" Leave blank to use the question above.`}>
            <Input value={config.parentLabel ?? ""} onChange={(e) => setConfig({ ...config, parentLabel: e.target.value || null })} />
          </FormField>
        )}
        <Checkbox checked={required} onChange={setRequired} label="Required for customers (staff can always skip)" />
        <TypeConfig type={type} config={config} setConfig={setConfig} rateCard={rateCard} others={others} />
        <FormField label="Only ask if…" help="Simple condition on another question.">
          <div className="flex gap-2">
            <Select value={showIf?.key ?? ""} onChange={(e) => setShowIf(e.target.value ? { key: e.target.value, equals: true } : null)}>
              <option value="">Always ask</option>
              {others.map((o) => (
                <option key={o.id} value={o.key}>
                  {o.label}
                </option>
              ))}
            </Select>
            {showIf && (
              <Input
                placeholder="equals (true, false, or an option value)"
                value={typeof showIf.equals === "string" ? showIf.equals : JSON.stringify(showIf.equals)}
                onChange={(e) => setShowIf({ ...showIf, equals: e.target.value === "true" ? true : e.target.value === "false" ? false : e.target.value })}
              />
            )}
          </div>
        </FormField>
        <Alert>{errorText(save.error ?? remove.error)}</Alert>
      </div>
      <div className="mt-4 flex justify-between gap-2">
        {field ? (
          <Button variant="ghost" className="text-red-600" onClick={() => remove.mutate({ ...payload, active: false })} loading={remove.isPending}>
            Remove question
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate(payload)} loading={save.isPending} disabled={!label || !key}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function TypeConfig({
  type,
  config,
  setConfig,
  rateCard,
  others,
}: {
  type: FieldType;
  config: FieldConfig;
  setConfig: (c: FieldConfig) => void;
  rateCard: { code: string; name: string; unitPriceCents: number }[];
  others: FieldRow[];
}) {
  const priceSelect = (value: string | null | undefined, onChange: (v: string | null) => void) => (
    <Select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">No price</option>
      {rateCard.map((r) => (
        <option key={r.code} value={r.code}>
          {r.name} ({formatCents(r.unitPriceCents)})
        </option>
      ))}
    </Select>
  );
  if (type === "select" || type === "multi_select") {
    const options = config.options ?? [];
    return (
      <FormField label="Options" help="Each option can add a rate card price to the estimate and the bill.">
        <div className="space-y-2">
          {options.map((o, i) => (
            <div key={i} className="flex gap-2">
              <Input
                value={o.label}
                placeholder="Label"
                onChange={(e) => {
                  const next = [...options];
                  next[i] = { ...o, label: e.target.value, value: o.value || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "_") };
                  setConfig({ ...config, options: next });
                }}
              />
              {priceSelect(o.rateCardCode, (code) => {
                const next = [...options];
                next[i] = { ...o, rateCardCode: code };
                setConfig({ ...config, options: next });
              })}
              <Button variant="ghost" onClick={() => setConfig({ ...config, options: options.filter((_, j) => j !== i) })}>
                ✕
              </Button>
            </div>
          ))}
          <Button size="sm" variant="secondary" onClick={() => setConfig({ ...config, options: [...options, { value: "", label: "" }] })}>
            Add option
          </Button>
        </div>
      </FormField>
    );
  }
  if (type === "number")
    return (
      <div className="grid gap-3 md:grid-cols-3">
        <FormField label="Min">
          <Input type="number" value={config.min ?? ""} onChange={(e) => setConfig({ ...config, min: e.target.value === "" ? undefined : Number(e.target.value) })} />
        </FormField>
        <FormField label="Max">
          <Input type="number" value={config.max ?? ""} onChange={(e) => setConfig({ ...config, max: e.target.value === "" ? undefined : Number(e.target.value) })} />
        </FormField>
        <FormField label="Price per unit">{priceSelect(config.rateCardCode, (c) => setConfig({ ...config, rateCardCode: c }))}</FormField>
      </div>
    );
  if (type === "yes_no") return <FormField label="Charge when yes">{priceSelect(config.rateCardCode, (c) => setConfig({ ...config, rateCardCode: c }))}</FormField>;
  if (type === "person")
    return (
      <div className="grid gap-3 md:grid-cols-2">
        <FormField label="Who is this?" help="Creates a real person on the booking, with their contacts and text consent.">
          <Select value={config.role ?? ""} onChange={(e) => setConfig({ ...config, role: e.target.value as FieldConfig["role"] })}>
            <option value="">Choose…</option>
            <option value="student">Student (also the customer)</option>
            <option value="guardian">Parent / guardian</option>
            <option value="customer">Customer (non-student services)</option>
          </Select>
        </FormField>
        <div className="pt-6">
          <Checkbox checked={!!config.askPhone} onChange={(c) => setConfig({ ...config, askPhone: c })} label="Mobile phone required" />
        </div>
      </div>
    );
  if (type === "appointment")
    return (
      <div className="grid gap-3 md:grid-cols-3">
        <FormField label="Appointment type">
          <Select value={config.appointmentType ?? ""} onChange={(e) => setConfig({ ...config, appointmentType: e.target.value as FieldConfig["appointmentType"] })}>
            <option value="">Choose…</option>
            <option value="pickup">Pickup</option>
            <option value="delivery">Delivery</option>
            <option value="move">Move</option>
            <option value="service">Other service</option>
          </Select>
        </FormField>
        <FormField label="Scheduling" help="Capacity windows are set on the Capacity page per school.">
          <Select value={config.scheduling ?? ""} onChange={(e) => setConfig({ ...config, scheduling: e.target.value as FieldConfig["scheduling"] })}>
            <option value="">Choose…</option>
            <option value="service_days">Pick from the school's capacity windows</option>
            <option value="customer_date">Customer requests a date</option>
          </Select>
        </FormField>
        <FormField label="Where" help="Defaults to their residence">
          <Select value={config.addressKey ?? ""} onChange={(e) => setConfig({ ...config, addressKey: e.target.value || null })}>
            <option value="">Residence / first address</option>
            {others
              .filter((o) => o.type === "address")
              .map((o) => (
                <option key={o.id} value={o.key}>
                  {o.label}
                </option>
              ))}
          </Select>
        </FormField>
      </div>
    );
  return null;
}

function Preview({ service, onClose }: { service: Service; onClose: () => void }) {
  const trpc = useTRPC();
  const lookups = useQuery(trpc.admin.bookings.lookups.queryOptions()).data;
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const fields: FieldDef[] = useMemo(
    () =>
      service.fields
        .filter((f) => f.active)
        .map((f) => ({ key: f.key, type: f.type as FieldType, label: f.label, help: f.help, required: f.required, sortOrder: f.sortOrder, config: f.config as FieldConfig, showIf: f.showIf })),
    [service],
  );
  const schoolField = fields.find((f) => f.type === "school");
  const ctx: FieldContext = {
    schools: lookups?.schools ?? [],
    schoolId: (schoolField ? (answers[schoolField.key] as string) : null) ?? null,
    slots: Object.fromEntries(fields.filter((f) => f.type === "appointment").map((f) => [f.key, { loading: false, slots: [], allowsSpecial: false }])),
  };
  return (
    <Modal open onClose={onClose} title={`Signup preview: ${service.name}`} wide>
      <p className="mb-3 text-sm text-slate-500">What a customer sees (pickup windows come from the Capacity page). Nothing here is saved.</p>
      <div className="space-y-4">
        {fields
          .filter((f) => !f.showIf || answers[f.showIf.key] === f.showIf.equals)
          .map((f) => (
            <FieldInput key={f.key} field={f} value={answers[f.key]} onChange={(v) => setAnswers({ ...answers, [f.key]: v })} ctx={ctx} />
          ))}
      </div>
    </Modal>
  );
}
