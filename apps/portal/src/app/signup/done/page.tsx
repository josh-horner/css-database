"use client";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, download, formatDate } from "@css/ui/kit";
import { useTRPC } from "@css/ui/trpc";
import { Shell } from "../../../components/shell";
import { icsFor, ShareReferral } from "../../../components/share";

export default function Done() {
  const trpc = useTRPC();
  const router = useRouter();
  const draft = useQuery(trpc.portal.signup.draft.queryOptions(undefined, { refetchOnMount: "always" }));
  const bookingId = draft.data?.lifecycle && draft.data.lifecycle !== "draft" ? draft.data.id : null;
  const booking = useQuery(trpc.portal.account.booking.queryOptions({ id: bookingId ?? "" }, { enabled: !!bookingId, retry: false }));
  const startOver = useMutation(trpc.portal.signup.startOver.mutationOptions({ onSuccess: () => router.push("/signup") }));
  const b = booking.data;

  if (draft.isLoading || (draft.isFetching && !bookingId)) return <Shell>Loading…</Shell>;
  if (!bookingId)
    return (
      <Shell>
        <p className="text-slate-600">
          No finished signup here. <Link href="/signup" className="text-brand underline">Start one</Link> or <Link href="/account" className="text-brand underline">sign in</Link>.
        </p>
      </Shell>
    );

  return (
    <Shell>
      <div className="space-y-5">
        <div className="rounded-2xl bg-brand p-6 text-white">
          <p className="text-sm uppercase tracking-wide text-white/80">You're signed up!</p>
          <p className="mt-2 text-sm">Your confirmation number</p>
          <p className="text-6xl font-black tabular-nums">{draft.data!.confirmationNumber}</p>
          <p className="mt-2 text-sm text-white/90">Write it on every box and item, or print labels. It's how we find your things.</p>
        </div>
        {b && (
          <>
            <Card title="What happens next">
              <ul className="space-y-2 text-sm">
                {b.appointments.map((a) => (
                  <li key={a.id}>
                    <span className="font-medium capitalize">{a.type}</span>: {formatDate(a.date, { weekday: "long", month: "long", day: "numeric" })}, {a.window}
                  </li>
                ))}
                <li>We'll text and email a reminder the day before, and again when the crew is on the way, with a live tracking link.</li>
                <li>After pickup we bill your card for what we picked up, from our price list.</li>
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href={`/account/bookings/${b.id}/labels`} className="rounded-md bg-brand px-3 py-2 text-sm font-medium text-white">
                  Print labels
                </Link>
                <Button variant="secondary" onClick={() => download(`css-${b.confirmationNumber}.ics`, icsFor(b.appointments, b.confirmationNumber), "text/calendar")}>
                  Add to calendar
                </Button>
                <Link href={`/account/bookings/${b.id}`} className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium">
                  View booking
                </Link>
              </div>
            </Card>
            {b.referral.link && b.referral.shareText && (
              <Card title="Know someone who needs storage?">
                <p className="mb-2 text-sm text-slate-600">Share your link. When they sign up, you both get a discount.</p>
                <ShareReferral link={b.referral.link} text={b.referral.shareText} />
              </Card>
            )}
          </>
        )}
        {booking.isError && <Alert tone="amber">Sign in to see your booking details.</Alert>}
        <button className="text-sm text-slate-500 underline" onClick={() => startOver.mutate()}>
          Sign up someone else
        </button>
      </div>
    </Shell>
  );
}
