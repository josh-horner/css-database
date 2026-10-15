"use client";
/** Sign in (code to email or phone) and the list of bookings this login can see (ADR-0004). */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { formatCents } from "@css/ui";
import { Alert, Badge, Button, FormField, Input, errorText, formatDate } from "@css/ui/kit";
import { useTRPC } from "@css/ui/trpc";
import { Shell } from "../../components/shell";

export default function Account() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const session = useQuery(trpc.portal.account.session.queryOptions());
  const home = useQuery(trpc.portal.account.home.queryOptions(undefined, { enabled: !!session.data, retry: false }));
  const signOut = useMutation(trpc.portal.account.signOut.mutationOptions({ onSuccess: () => qc.invalidateQueries() }));

  if (session.isLoading) return <Shell>Loading…</Shell>;
  if (!session.data) return <SignIn />;
  const h = home.data;
  return (
    <Shell
      right={
        <button className="text-slate-600 hover:text-slate-900" onClick={() => signOut.mutate()}>
          Sign out
        </button>
      }
    >
      <h1 className="text-2xl font-semibold">{h?.names[0] ? `Hi, ${h.names[0].split(" ")[0]}` : "Your account"}</h1>
      <p className="text-sm text-slate-500">Signed in as {h?.contact.value}</p>
      {h?.draft && (
        <Alert tone="blue">
          You have a signup in progress. <Link href="/signup" className="font-medium underline">Finish it</Link>
        </Alert>
      )}
      <div className="mt-4 space-y-3">
        {h?.bookings.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-slate-600">
            No bookings for this login yet. If someone else signed you up, ask them to add you, or{" "}
            <Link href="/signup" className="text-brand underline">
              sign up
            </Link>
            .
          </div>
        )}
        {h?.bookings.map((b) => (
          <Link key={b.id} href={`/account/bookings/${b.id}`} className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  {b.schoolColor && <span className="h-3 w-3 rounded-full" style={{ background: b.schoolColor }} />}
                  <span className="text-lg font-semibold">#{b.confirmationNumber}</span>
                  <span className="text-slate-600">{b.customerName}</span>
                </div>
                <div className="text-sm text-slate-500">
                  {b.season} · {b.services.join(", ")}
                </div>
                {b.nextAppointment && (
                  <div className="mt-1 text-sm">
                    Next: <span className="capitalize">{b.nextAppointment.type}</span> {formatDate(b.nextAppointment.date)}, {b.nextAppointment.window}
                  </div>
                )}
              </div>
              <div className="text-right">
                <Badge tone={b.lifecycle === "cancelled" ? "red" : "blue"}>{b.lifecycle.replace(/_/g, " ")}</Badge>
                {b.balanceCents > 0 && <div className={b.paymentStatus === "past_due" ? "mt-1 text-sm font-semibold text-red-600" : "mt-1 text-sm"}>{formatCents(b.balanceCents)} due</div>}
              </div>
            </div>
          </Link>
        ))}
      </div>
      <div className="mt-6">
        <Link href="/signup" className="text-sm text-brand underline">
          Start a new signup
        </Link>
      </div>
    </Shell>
  );
}

function SignIn() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [contact, setContact] = useState("");
  const [code, setCode] = useState("");
  const send = useMutation(trpc.portal.account.sendCode.mutationOptions());
  const verify = useMutation(trpc.portal.account.verify.mutationOptions({ onSuccess: () => qc.invalidateQueries() }));
  return (
    <Shell>
      <div className="mx-auto max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <p className="text-sm text-slate-600">Use the email or mobile number on your booking (student or parent). We'll send a code; no password needed.</p>
        {!send.data ? (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              send.mutate({ contact });
            }}
          >
            <FormField label="Email or mobile number" htmlFor="contact">
              <Input id="contact" autoComplete="username" value={contact} onChange={(e) => setContact(e.target.value)} required />
            </FormField>
            <Button type="submit" className="w-full" loading={send.isPending}>
              Send me a code
            </Button>
          </form>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              verify.mutate({ contact, code });
            }}
          >
            <p className="text-sm">We sent a code to {send.data.sentTo}.</p>
            {send.data.demoCode && <Alert tone="amber">Demo mode: your code is {send.data.demoCode}</Alert>}
            <FormField label="Code" htmlFor="code">
              <Input id="code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
            </FormField>
            <Button type="submit" className="w-full" loading={verify.isPending}>
              Sign in
            </Button>
            <button type="button" className="text-sm text-slate-500 underline" onClick={() => send.reset()}>
              Use a different email or number
            </button>
          </form>
        )}
        <Alert>{errorText(send.error) ?? errorText(verify.error)}</Alert>
      </div>
    </Shell>
  );
}
