"use client";
/**
 * Signup wizard (docs/features/signup-funnel.md). The steps come from the selected services' fields; every
 * step autosaves to the draft and logs funnel events; verification and the card happen at the end.
 */
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { AppRouter } from "@css/api";
import { formatCents, formatPhone, isSignerField, labelFor, normalizePhone, type FieldDef, type SignerRole, type MergedField, type WizardStep } from "@css/domain";
import { cx } from "@css/ui";
import { FieldInput, type FieldContext } from "@css/ui/fields";
import { Alert, Button, Checkbox, FormField, Input, Select, errorText } from "@css/ui/kit";
import { useTRPC } from "@css/ui/trpc";
import { Shell } from "../../components/shell";
import { CardStep, type CardResult } from "./card";

const HEARD = ["Friend or roommate", "Parent Facebook group", "Instagram", "TikTok", "Flyer on campus", "School website", "Google", "Used CSS before", "Other"];

export function Wizard({ refCode, via }: { refCode: string | null; via: string | null }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const router = useRouter();
  const draftQ = useQuery(trpc.portal.signup.draft.queryOptions());
  const schoolsQ = useQuery(trpc.portal.signup.schools.queryOptions());
  const draft = draftQ.data;
  const [step, setStep] = useState<WizardStep | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [signerRole, setSignerRole] = useState<"student" | "guardian" | "other" | null>(null);
  const view = useMutation(trpc.portal.signup.view.mutationOptions());

  // Seed local state from the saved draft once it loads (and when switching drafts).
  const draftId = draft?.id ?? null;
  useEffect(() => {
    if (!draft) return;
    setAnswers(draft.answers);
    setSignerRole(draft.signerRole);
    setStep((s) => s ?? (draft.lifecycle === "draft" ? draft.stepReached : "done"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  useEffect(() => {
    if (draft?.lifecycle && draft.lifecycle !== "draft") router.replace(`/signup/done`);
  }, [draft?.lifecycle, router]);

  const current: WizardStep = draft ? (step ?? draft.stepReached) : "contact";
  useEffect(() => {
    if (draft && draft.lifecycle === "draft") view.mutate({ step: current });
    window.scrollTo({ top: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, draftId]);

  const steps = draft?.steps ?? [{ id: "contact" as const, title: "Start" }];
  const idx = steps.findIndex((s) => s.id === current);
  const go = (s: WizardStep) => {
    setErrors({});
    setStep(s);
  };
  const next = () => go(steps[Math.min(idx + 1, steps.length - 1)]!.id);
  const back = () => go(steps[Math.max(idx - 1, 0)]!.id);
  const refresh = (d: unknown) => qc.setQueryData(trpc.portal.signup.draft.queryKey(), d as typeof draft);

  if (draftQ.isLoading) return <Shell>Loading…</Shell>;

  return (
    <Shell wide>
      {draft && <Progress steps={steps.filter((s) => s.id !== "done")} current={current} reached={draft.stepReached} onGo={go} />}
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0">
          {current === "contact" && <ContactStep draft={draft ?? null} refCode={refCode} via={via} onDone={(d) => (refresh(d), go("services"))} />}
          {current === "services" && draft && <ServicesStep draft={draft} onDone={(d) => (refresh(d), go(d!.steps[2]!.id))} onBack={back} />}
          {draft && ["school", "people", "schedule", "details"].includes(current) && (
            <FieldsStep
              key={current}
              step={current}
              draft={draft}
              schools={schoolsQ.data ?? []}
              answers={answers}
              setAnswers={setAnswers}
              errors={errors}
              setErrors={setErrors}
              signerRole={signerRole}
              onDone={(d) => (refresh(d), next())}
              onBack={back}
              onChangeSigner={() => go("contact")}
            />
          )}
          {current === "review" && draft && <ReviewStep draft={draft} schools={schoolsQ.data ?? []} onEdit={go} onBack={back} onDone={() => router.push("/signup/done")} />}
        </div>
        {draft && current !== "contact" && <EstimatePanel draft={draft} />}
      </div>
    </Shell>
  );
}

type Draft = NonNullable<inferRouterOutputs<AppRouter>["portal"]["signup"]["draft"]>;

function Progress({ steps, current, reached, onGo }: { steps: { id: WizardStep; title: string }[]; current: WizardStep; reached: WizardStep; onGo: (s: WizardStep) => void }) {
  const reachedIdx = steps.findIndex((s) => s.id === reached);
  return (
    <ol className="flex gap-1 overflow-x-auto text-xs">
      {steps.map((s, i) => {
        const can = i <= Math.max(reachedIdx, 0);
        return (
          <li key={s.id} className="min-w-16 flex-1">
            <button
              type="button"
              disabled={!can}
              onClick={() => onGo(s.id)}
              className={cx("w-full border-t-4 pt-1.5 text-left", s.id === current ? "border-brand font-semibold text-brand" : can ? "border-brand/40 text-slate-600" : "border-slate-200 text-slate-400")}
            >
              {s.title}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function EstimatePanel({ draft }: { draft: Draft }) {
  const e = draft.estimate;
  if (!draft.services.length) return null;
  return (
    <aside className="h-fit rounded-xl border border-slate-200 bg-white p-4 text-sm lg:sticky lg:top-4">
      <h2 className="font-semibold">Your estimate</h2>
      <ul className="mt-2 space-y-1 text-slate-700">
        {draft.services.map((s) => (
          <li key={s.id}>• {s.name}</li>
        ))}
      </ul>
      <dl className="mt-3 space-y-1 border-t border-slate-100 pt-3">
        {e.depositCents > 0 && (
          <div className="flex justify-between">
            <dt>Due today (sign-up fee)</dt>
            <dd className="font-semibold">{formatCents(e.depositCents)}</dd>
          </div>
        )}
        {e.lines.map((l, i) => (
          <div key={i} className="flex justify-between text-slate-600">
            <dt>{l.description}</dt>
            <dd>{l.kind === "discount" ? `−${formatCents(l.unitPriceCents)}` : formatCents(l.quantity * l.unitPriceCents)}</dd>
          </div>
        ))}
      </dl>
      {e.itemsPricedAtPickup && <p className="mt-3 text-xs text-slate-500">Storage is priced per item from our price list (e.g. boxes $39–$59) and billed after pickup.</p>}
      {draft.code?.valid && <p className="mt-2 rounded bg-green-50 px-2 py-1 text-xs text-green-800">{draft.code.description}</p>}
    </aside>
  );
}

const SIGNERS: { role: SignerRole; title: string; help: string }[] = [
  { role: "student", title: "I'm the student", help: "Signing up for my own storage or move" },
  { role: "guardian", title: "I'm a parent or guardian", help: "Signing up my student" },
  { role: "other", title: "Someone else", help: "Booking a move or delivery, or helping out" },
];

function ContactStep({ draft, refCode, via, onDone }: { draft: Draft | null; refCode: string | null; via: string | null; onDone: (d: Draft | null) => void }) {
  const trpc = useTRPC();
  const session = useQuery(trpc.portal.account.session.queryOptions()).data;
  const signedInEmail = session?.kind === "email" ? session.value : null;
  const [role, setRole] = useState<SignerRole | null>(draft?.signerRole ?? null);
  const [email, setEmail] = useState(draft?.signer.email ?? "");
  const [phone, setPhone] = useState(draft?.signer.phone ?? "");
  const [sms, setSms] = useState(draft?.signer.smsConsent ?? false);
  const [marketing, setMarketing] = useState(draft?.signer.marketingConsent ?? false);
  const start = useMutation(trpc.portal.signup.start.mutationOptions({ onSuccess: (d) => onDone(d as Draft | null) }));
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (role) start.mutate({ signerRole: role, email: signedInEmail ? null : email, phone: phone || null, smsConsent: sms, marketingConsent: marketing, code: refCode, via });
      }}
    >
      <div>
        <h1 className="text-2xl font-semibold">Sign up with CSS</h1>
        <p className="mt-1 text-slate-600">Storage, moving, and shipping for Colorado college students since 1996. It takes about five minutes, and we save as you go.</p>
      </div>
      {refCode && <Alert tone="green">You were referred by a friend. Your discount is applied at checkout.</Alert>}
      <FormField label="Who's signing up?">
        <div className="grid gap-2 sm:grid-cols-3">
          {SIGNERS.map((s) => (
            <button
              key={s.role}
              type="button"
              onClick={() => setRole(s.role)}
              className={cx("rounded-lg border p-3 text-left", role === s.role ? "border-brand bg-brand/5 ring-2 ring-brand/30" : "border-slate-300 bg-white hover:border-slate-400")}
            >
              <span className="block font-medium">{s.title}</span>
              <span className="block text-xs text-slate-500">{s.help}</span>
            </button>
          ))}
        </div>
      </FormField>
      {role && (
        <>
          {signedInEmail ? (
            <p className="text-sm text-slate-600">
              Signed in as <strong>{signedInEmail}</strong>. We'll send the confirmation there.
            </p>
          ) : (
            <FormField label="Your email" help={role === "guardian" ? "Use your own email; you'll add your student's next." : "We'll send your confirmation here."} htmlFor="email">
              <Input id="email" type="email" inputMode="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </FormField>
          )}
          <FormField label="Your mobile phone (optional)" htmlFor="phone">
            <Input id="phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </FormField>
          {phone.trim() && <Checkbox checked={sms} onChange={setSms} label="CSS can text me if I get stuck" help="One reminder text at most. Reply STOP anytime." />}
          <Checkbox checked={marketing} onChange={setMarketing} label="Email me tips and offers from CSS" help="Optional. You'll always get emails about your own booking." />
        </>
      )}
      <Alert>{errorText(start.error)}</Alert>
      <Button type="submit" size="lg" className="w-full sm:w-auto" loading={start.isPending} disabled={!role}>
        Continue
      </Button>
    </form>
  );
}

function ServicesStep({ draft, onDone, onBack }: { draft: Draft; onDone: (d: Draft | null) => void; onBack: () => void }) {
  const trpc = useTRPC();
  const catalog = useQuery(trpc.portal.signup.catalog.queryOptions({}));
  const [picked, setPicked] = useState<string[]>(draft.services.map((s) => s.id));
  const save = useMutation(trpc.portal.signup.services.mutationOptions({ onSuccess: (d) => onDone(d as Draft | null) }));
  const families = useMemo(() => {
    const list = catalog.data ?? [];
    return [
      { title: "Student storage", items: list.filter((s) => s.collectsSchool) },
      { title: "Moving, shipping & more", items: list.filter((s) => !s.collectsSchool) },
    ].filter((f) => f.items.length);
  }, [catalog.data]);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">What do you need?</h1>
        <p className="mt-1 text-slate-600">Pick everything that applies. We'll only ask for what these need.</p>
      </div>
      {families.map((f) => (
        <section key={f.title} className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{f.title}</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {f.items.map((s) => {
              const on = picked.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setPicked(on ? picked.filter((x) => x !== s.id) : [...picked, s.id])}
                  className={cx("rounded-lg border p-3 text-left", on ? "border-brand bg-brand/5 ring-2 ring-brand/30" : "border-slate-300 bg-white hover:border-slate-400")}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium">{s.name}</span>
                    <span className={cx("mt-0.5 h-5 w-5 shrink-0 rounded border", on ? "border-brand bg-brand text-center text-xs leading-5 text-white" : "border-slate-300")}>{on ? "✓" : ""}</span>
                  </div>
                  {s.description && <p className="mt-1 text-sm text-slate-600">{s.description}</p>}
                </button>
              );
            })}
          </div>
        </section>
      ))}
      <Alert>{errorText(save.error)}</Alert>
      <Nav onBack={onBack} onNext={() => save.mutate({ serviceIds: picked })} loading={save.isPending} disabled={!picked.length} />
    </div>
  );
}

function stepCopy(step: WizardStep, role: SignerRole | null, scheduleTitleText: string): { title: string; intro: string } | null {
  const parent = role === "guardian";
  switch (step) {
    case "school":
      return parent
        ? { title: "Where's your student?", intro: "Their school and where they live, so the crew can find them." }
        : { title: "Where are you?", intro: "Your school and where you live, so the crew can find you." };
    case "people":
      return parent
        ? { title: "You and your student", intro: "We send updates to both of you, and either of you can sign in to see the booking." }
        : role === "student"
          ? { title: "You and a parent", intro: "We send updates to both of you, and either of you can sign in to see the booking." }
          : { title: "Contact info", intro: "Who we should reach about this booking." };
    case "schedule":
      return { title: scheduleTitleText, intro: "Pick a day. You can change it later in your account." };
    case "details":
      return { title: "A few details", intro: "" };
    default:
      return null;
  }
}

function FieldsStep(props: {
  step: WizardStep;
  draft: Draft;
  schools: FieldContext["schools"];
  answers: Record<string, unknown>;
  setAnswers: (a: Record<string, unknown>) => void;
  errors: Record<string, string>;
  setErrors: (e: Record<string, string>) => void;
  signerRole: "student" | "guardian" | "other" | null;
  onDone: (d: Draft | null) => void;
  onBack: () => void;
  onChangeSigner: () => void;
}) {
  const { step, draft, answers, setAnswers, errors, setErrors, signerRole } = props;
  const trpc = useTRPC();
  const fields = (draft.fieldsByStep[step] ?? []) as MergedField[];
  const save = useMutation(
    trpc.portal.signup.save.mutationOptions({
      onSuccess: (r) => {
        if (r.ok) props.onDone(r.draft as Draft | null);
        else setErrors(r.errors);
      },
    }),
  );
  const schoolField = (Object.values(draft.fieldsByStep).flat() as MergedField[]).find((f) => f.type === "school");
  const schoolId = (schoolField ? (answers[schoolField.key] as string | undefined) : undefined) ?? null;

  // Pickup windows for capacity-managed appointment fields.
  const slotFields = fields.filter((f) => f.type === "appointment" && f.config.scheduling === "service_days");
  const slotResults = useQueries({ queries: slotFields.map((f) => trpc.portal.signup.availability.queryOptions({ fieldKey: f.key }, { enabled: !!schoolId })) });
  const slotQueries = slotFields.map((f, i) => ({ key: f.key, q: slotResults[i]! }));
  const ctx: FieldContext = {
    schools: props.schools,
    schoolId,
    minDate: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
    signerRole,
    slots: Object.fromEntries(slotQueries.map(({ key, q }) => [key, { loading: q.isLoading, slots: q.data?.slots ?? [], allowsSpecial: q.data?.allowsSpecial }])),
  };

  // The signer's own details go into the person they said they are (from step 1).
  useEffect(() => {
    const mine = fields.find((f) => isSignerField(f, signerRole));
    if (!mine) return;
    const cur = (answers[mine.key] ?? {}) as Record<string, unknown>;
    if (cur.email && cur.firstName) return;
    setAnswers({
      ...answers,
      [mine.key]: {
        firstName: draft.signer.firstName,
        lastName: draft.signer.lastName,
        ...cur,
        email: cur.email || draft.signer.email || "",
        phone: cur.phone || (draft.signer.phone ? formatPhone(draft.signer.phone) : ""),
        smsConsent: cur.smsConsent ?? draft.signer.smsConsent,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);
  const copy = stepCopy(step, signerRole, draft.steps.find((s) => s.id === "schedule")?.title ?? "When?");

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ step, answers: Object.fromEntries(fields.map((f) => [f.key, answers[f.key]])), signerRole: signerRole ?? undefined });
      }}
    >
      {copy && (
        <div>
          <h1 className="text-2xl font-semibold">{copy.title}</h1>
          {copy.intro && <p className="mt-1 text-slate-600">{copy.intro}</p>}
        </div>
      )}
      {step === "people" && signerRole && (
        <p className="text-sm text-slate-500">
          Signing up as {signerRole === "guardian" ? "a parent or guardian" : signerRole === "student" ? "the student" : "someone else"}.{" "}
          <button type="button" className="text-brand underline" onClick={props.onChangeSigner}>
            Change
          </button>
          {errors._signer && <span className="ml-2 font-medium text-red-600">{errors._signer}</span>}
        </p>
      )}
      {fields.map((f) => (
        <FieldInput key={f.key} field={{ ...(f as FieldDef), label: labelFor(f, signerRole) }} value={answers[f.key]} onChange={(v) => setAnswers({ ...answers, [f.key]: v })} error={errors[f.key]} ctx={ctx} />
      ))}
      {draft.services
        .filter((s) => s.instructions && step === "details")
        .map((s) => (
          <Alert key={s.id} tone="blue">
            {s.instructions}
          </Alert>
        ))}
      {Object.keys(errors).length > 0 && <Alert>Please fix the highlighted answers.</Alert>}
      <Alert>{errorText(save.error)}</Alert>
      <Nav onBack={props.onBack} loading={save.isPending} submit />
    </form>
  );
}

function Nav({ onBack, onNext, loading, disabled, submit, label = "Continue" }: { onBack?: () => void; onNext?: () => void; loading?: boolean; disabled?: boolean; submit?: boolean; label?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-4">
      {onBack ? (
        <Button type="button" variant="ghost" onClick={onBack}>
          ← Back
        </Button>
      ) : (
        <span />
      )}
      <Button type={submit ? "submit" : "button"} size="lg" onClick={onNext} loading={loading} disabled={disabled}>
        {label}
      </Button>
    </div>
  );
}

function ReviewStep({ draft, schools, onEdit, onBack, onDone }: { draft: Draft; schools: FieldContext["schools"]; onEdit: (s: WizardStep) => void; onBack: () => void; onDone: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: trpc.portal.signup.draft.queryKey() });
  const [code, setCode] = useState("");
  const [promo, setPromo] = useState("");
  const [heard, setHeard] = useState(draft.heardFrom ?? "");
  const [terms, setTerms] = useState(false);
  const [card, setCard] = useState<CardResult | null>(null);
  const sendCode = useMutation(trpc.portal.signup.sendCode.mutationOptions());
  const verify = useMutation(trpc.portal.signup.verify.mutationOptions({ onSuccess: invalidate }));
  const applyCode = useMutation(trpc.portal.signup.applyCode.mutationOptions({ onSuccess: invalidate }));
  const complete = useMutation(
    trpc.portal.signup.complete.mutationOptions({
      onSuccess: async () => {
        await qc.invalidateQueries();
        onDone();
      },
    }),
  );
  const deposit = draft.estimate.depositCents;
  const fields = Object.values(draft.fieldsByStep).flat() as MergedField[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Review & pay</h1>
        <p className="mt-1 text-slate-600">Check everything, confirm your email, and add a card.</p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
        <SummaryRow label="Services" onEdit={() => onEdit("services")}>{draft.services.map((s) => s.name).join(", ")}</SummaryRow>
        {fields.map((f) => (
          <SummaryRow key={f.key} label={labelFor(f, draft.signerRole)} onEdit={() => onEdit(stepOf(draft, f.key))}>
            {describe(f, draft.answers[f.key], schools)}
          </SummaryRow>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Referral or promo code</h2>
        {draft.code?.valid ? (
          <Alert tone="green">{draft.code.description} ({draft.code.code})</Alert>
        ) : (
          <div className="flex gap-2">
            <Input value={promo} onChange={(e) => setPromo(e.target.value)} placeholder="Code" className="max-w-48" />
            <Button variant="secondary" onClick={() => applyCode.mutate({ code: promo })} loading={applyCode.isPending} disabled={!promo.trim()}>
              Apply
            </Button>
          </div>
        )}
        {applyCode.data && !applyCode.data.ok && <p className="text-xs text-red-600">{applyCode.data.message}</p>}
      </section>

      <FormField label="How did you hear about us? (optional)">
        <Select value={heard} onChange={(e) => setHeard(e.target.value)} className="max-w-72">
          <option value="">Choose…</option>
          {HEARD.map((h) => (
            <option key={h}>{h}</option>
          ))}
        </Select>
      </FormField>

      <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">1. Confirm your email</h2>
        {draft.verified ? (
          <Alert tone="green">✓ {draft.signer.email} confirmed</Alert>
        ) : (
          <>
            <p className="text-sm text-slate-600">We'll email a 6-digit code to {draft.signer.email}. This protects your booking and lets you sign in later.</p>
            {!sendCode.data ? (
              <Button variant="secondary" onClick={() => sendCode.mutate()} loading={sendCode.isPending}>
                Email me a code
              </Button>
            ) : (
              <div className="space-y-2">
                {sendCode.data.demoCode && <Alert tone="amber">Demo mode: your code is {sendCode.data.demoCode}</Alert>}
                <div className="flex gap-2">
                  <Input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" className="max-w-32" />
                  <Button onClick={() => verify.mutate({ code })} loading={verify.isPending} disabled={code.trim().length < 6}>
                    Confirm
                  </Button>
                  <Button variant="ghost" onClick={() => sendCode.mutate()}>
                    Resend
                  </Button>
                </div>
              </div>
            )}
            <Alert>{errorText(sendCode.error) ?? errorText(verify.error)}</Alert>
          </>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">2. Card</h2>
        <CardStep payments={draft.payments} disabled={!draft.verified} onReady={setCard} ready={card} />
        <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">{draft.authorizationText}</p>
        <Checkbox
          checked={terms}
          onChange={setTerms}
          label={
            <>
              I agree to the{" "}
              <a href="https://www.csstorage.com/terms" target="_blank" rel="noreferrer" className="text-brand underline">
                CSS terms and conditions
              </a>
              .
            </>
          }
        />
      </section>

      <Alert>{errorText(complete.error)}</Alert>
      <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-4">
        <Button variant="ghost" onClick={onBack}>
          ← Back
        </Button>
        <Button
          size="lg"
          disabled={!draft.verified || !terms || !card}
          loading={complete.isPending}
          onClick={async () => {
            const ok = await card!.confirm();
            if (ok) complete.mutate({ acceptTerms: terms, heardFrom: heard || null, demoToken: card!.demoToken });
          }}
        >
          {deposit > 0 ? `Pay ${formatCents(deposit)} deposit and sign up` : "Sign up"}
        </Button>
      </div>
    </div>
  );
}

function SummaryRow({ label, children, onEdit }: { label: string; children: React.ReactNode; onEdit: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-2 last:border-0">
      <div>
        <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
        <div className="text-slate-900">{children}</div>
      </div>
      <button type="button" onClick={onEdit} className="text-xs text-brand underline">
        Edit
      </button>
    </div>
  );
}

function stepOf(draft: Draft, key: string): WizardStep {
  for (const [s, fs] of Object.entries(draft.fieldsByStep)) if ((fs as MergedField[]).some((f) => f.key === key)) return s as WizardStep;
  return "services";
}

function describe(f: MergedField, v: unknown, schools: FieldContext["schools"]): string {
  if (v === undefined || v === null || v === "") return "—";
  switch (f.type) {
    case "school":
      return schools.find((s) => s.id === v)?.name ?? "—";
    case "residence": {
      const r = v as { residenceId: string; room?: string; address?: string };
      const res = schools.flatMap((s) => s.residences).find((x) => x.id === r.residenceId);
      return [res?.name, r.room && `room ${r.room}`, r.address].filter(Boolean).join(", ");
    }
    case "person": {
      const p = v as { firstName: string; lastName: string; email?: string; phone?: string };
      return [`${p.firstName} ${p.lastName}`, p.email, p.phone && formatPhone(normalizePhone(p.phone) ?? p.phone)].filter(Boolean).join(" · ");
    }
    case "appointment": {
      const a = v as { date: string; windowId?: string | null; special?: boolean };
      const win = a.windowId === "AM" ? "9:30 AM – 12:30 PM" : a.windowId === "PM" ? "1:30 – 4:30 PM" : "any time that day";
      return a.date ? `${new Date(`${a.date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}, ${win}${a.special ? " (special pickup)" : ""}` : "—";
    }
    case "yes_no":
      return v ? "Yes" : "No";
    case "select":
      return f.config.options?.find((o) => o.value === v)?.label ?? String(v);
    case "multi_select":
      return (v as string[]).map((x) => f.config.options?.find((o) => o.value === x)?.label ?? x).join(", ");
    default:
      return String(v);
  }
}
