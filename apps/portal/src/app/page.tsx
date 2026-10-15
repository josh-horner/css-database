import Link from "next/link";
import { Shell } from "../components/shell";

export default function Home() {
  return (
    <Shell>
      <div className="space-y-6 py-6">
        <div>
          <h1 className="text-3xl font-bold text-brand-ink">College Student Storage</h1>
          <p className="mt-2 text-lg text-slate-600">Summer storage, moving, and shipping for Colorado college students since 1996.</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link href="/signup" className="rounded-lg bg-brand px-6 py-3 text-center text-lg font-semibold text-white">
            Sign up
          </Link>
          <Link href="/account" className="rounded-lg border border-slate-300 bg-white px-6 py-3 text-center text-lg font-semibold">
            My account
          </Link>
        </div>
        <p className="text-sm text-slate-500">Track your crew and pay from the links in your texts and emails.</p>
      </div>
    </Shell>
  );
}
