"use client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cx } from "@css/ui";
import { useTRPC } from "@css/ui/trpc";

type CountKey = "review" | "escalated" | "collections" | "claims" | "leads";
const NAV: { group: string; items: { href: string; label: string; count?: CountKey }[] }[] = [
  { group: "", items: [{ href: "/dashboard", label: "Today" }] },
  {
    group: "Customers",
    items: [
      { href: "/bookings", label: "Bookings" },
      { href: "/leads", label: "Hot leads", count: "leads" },
      { href: "/inbox", label: "Conversations", count: "escalated" },
      { href: "/claims", label: "Claims", count: "claims" },
    ],
  },
  {
    group: "Money",
    items: [
      { href: "/review", label: "Invoice review", count: "review" },
      { href: "/collections", label: "Collections", count: "collections" },
      { href: "/tips", label: "Tips" },
      { href: "/reports", label: "Reports" },
    ],
  },
  {
    group: "Operations",
    items: [
      { href: "/calendar", label: "Calendar" },
      { href: "/capacity", label: "Capacity" },
      { href: "/crews", label: "Crews" },
      { href: "/dispatch", label: "Dispatch" },
      { href: "/warehouse", label: "Warehouse" },
    ],
  },
  {
    group: "Setup",
    items: [
      { href: "/settings/services", label: "Services" },
      { href: "/settings/rate-card", label: "Rate card" },
      { href: "/settings/schools", label: "Schools" },
      { href: "/settings/seasons", label: "Seasons" },
      { href: "/settings/promotions", label: "Promotions" },
      { href: "/settings/knowledge", label: "Knowledge base" },
      { href: "/settings/people", label: "Staff & crew" },
      { href: "/settings/general", label: "Settings" },
      { href: "/settings/costs", label: "Services & costs" },
    ],
  },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const trpc = useTRPC();
  const router = useRouter();
  const pathname = usePathname();
  const me = useQuery(trpc.admin.me.queryOptions(undefined, { retry: false }));
  const counts = useQuery(trpc.admin.counts.queryOptions(undefined, { refetchInterval: 10_000, enabled: me.isSuccess }));
  const [open, setOpen] = useState(false);
  const logout = useMutation({ mutationFn: () => fetch("/auth/staff/logout", { method: "POST" }), onSuccess: () => router.replace("/login") });

  useEffect(() => {
    if (me.error instanceof TRPCClientError && me.error.data?.code === "UNAUTHORIZED") router.replace("/login");
  }, [me.error, router]);
  useEffect(() => setOpen(false), [pathname]);

  if (!me.data) return <div className="p-8 text-slate-500">Loading…</div>;

  return (
    <div className="flex min-h-full flex-col md:flex-row print:block">
      <aside className="border-b border-slate-200 bg-white md:sticky md:top-0 md:h-screen md:w-56 md:shrink-0 md:overflow-y-auto md:border-b-0 md:border-r print:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <div className="text-lg font-semibold text-brand-ink">CSS Admin</div>
            <div className="text-xs text-slate-500">
              {me.data.name} · {me.data.role}
            </div>
          </div>
          <button className="rounded-md border border-slate-300 px-2 py-1 text-sm md:hidden" onClick={() => setOpen(!open)}>
            Menu
          </button>
        </div>
        <nav className={cx("space-y-3 px-2 pb-4", open ? "block" : "hidden md:block")}>
          {NAV.map((g) => (
            <div key={g.group}>
              {g.group && <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{g.group}</div>}
              {g.items.map((item) => {
                const n = item.count ? counts.data?.[item.count] : undefined;
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cx("flex items-center justify-between rounded-md px-3 py-1.5 text-sm", active ? "bg-brand text-white" : "text-slate-700 hover:bg-slate-100")}
                  >
                    {item.label}
                    {!!n && <span className={cx("ml-2 rounded-full px-2 text-xs font-semibold", active ? "bg-white text-brand" : "bg-amber-100 text-amber-800")}>{n}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
          <button onClick={() => logout.mutate()} className="w-full rounded-md px-3 py-1.5 text-left text-sm text-slate-500 hover:bg-slate-100">
            Sign out
          </button>
        </nav>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-6 print:p-0">{children}</main>
    </div>
  );
}
