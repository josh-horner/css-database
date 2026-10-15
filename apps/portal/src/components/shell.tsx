import Link from "next/link";
import type { ReactNode } from "react";

/** Page frame for the customer site: brand bar, centered column, mobile-first. */
export function Shell({ children, wide, right }: { children: ReactNode; wide?: boolean; right?: ReactNode }) {
  return (
    <div className="min-h-full bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className={`mx-auto flex items-center justify-between px-4 py-3 ${wide ? "max-w-5xl" : "max-w-2xl"}`}>
          <Link href="/" className="text-sm font-bold tracking-wide text-brand">
            COLLEGE STUDENT STORAGE
          </Link>
          <div className="flex items-center gap-3 text-sm">{right ?? <Link href="/account" className="text-slate-600 hover:text-slate-900">My account</Link>}</div>
        </div>
      </header>
      <main className={`mx-auto px-4 py-6 ${wide ? "max-w-5xl" : "max-w-2xl"}`}>{children}</main>
    </div>
  );
}
