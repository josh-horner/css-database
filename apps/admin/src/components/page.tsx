import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-4 flex flex-wrap items-end justify-between gap-3 print:hidden">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export const LIFECYCLE_TONE: Record<string, "slate" | "blue" | "green" | "amber" | "red" | "purple"> = {
  draft: "slate",
  confirmed: "blue",
  picked_up: "purple",
  in_storage: "purple",
  delivery_scheduled: "amber",
  delivered: "green",
  closed: "green",
  cancelled: "red",
};

export const PAYMENT_TONE: Record<string, "slate" | "blue" | "green" | "amber" | "red" | "purple"> = {
  none_due: "slate",
  balance_due: "amber",
  paid: "green",
  past_due: "red",
  credit: "blue",
  written_off: "slate",
};

export const human = (s: string) => s.replace(/_/g, " ");

export function todayIso() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver" }).format(new Date());
}

export function addDaysIso(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
