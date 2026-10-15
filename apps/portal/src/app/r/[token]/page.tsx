"use client";
/** Rate the crew and tip them (one box per crew member, pre-filled; each person gets exactly that amount). */
import { useMutation, useQuery } from "@tanstack/react-query";
import { use, useEffect, useState } from "react";
import { cx, formatCents, parseDollars } from "@css/ui";
import { Alert, Button, FormField, Input, Textarea, errorText } from "@css/ui/kit";
import { useTRPC } from "@css/ui/trpc";
import { Shell } from "../../../components/shell";

export default function Rate({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const trpc = useTRPC();
  const page = useQuery(trpc.portal.ratePage.queryOptions({ token }, { retry: false }));
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [tips, setTips] = useState<Record<string, string>>({});
  const submit = useMutation(trpc.portal.rate.mutationOptions());
  const p = page.data;
  useEffect(() => {
    if (p && !Object.keys(tips).length) setTips(Object.fromEntries(p.members.map((m) => [m.id, (p.tipDefaultCents / 100).toFixed(0)])));
  }, [p, tips]);
  const total = Object.values(tips).reduce((s, v) => s + (parseDollars(v || "0") ?? 0), 0);

  if (page.isError) return <Shell>This link isn't ready yet. It works after your crew finishes.</Shell>;
  if (!p) return <Shell>Loading…</Shell>;
  if (submit.isSuccess || p.rated)
    return (
      <Shell>
        <h1 className="text-2xl font-semibold">Thank you!</h1>
        <p className="mt-2 text-slate-600">{submit.data?.tipped ? `Your ${formatCents(submit.data.tipped)} tip goes entirely to the crew.` : "Your feedback goes straight to the owner."}</p>
      </Shell>
    );
  return (
    <Shell>
      <h1 className="text-2xl font-semibold">How did {p.crewName} do?</h1>
      <p className="text-sm text-slate-500">
        Your {p.type} on {p.date} · #{p.confirmationNumber}
      </p>
      <div className="mt-4 flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => setRating(n)} className={cx("text-4xl", n <= rating ? "text-amber-400" : "text-slate-300")} aria-label={`${n} stars`}>
            ★
          </button>
        ))}
      </div>
      <FormField label="Anything to add? (optional)" className="mt-4">
        <Textarea value={comment} onChange={(e) => setComment(e.target.value)} />
      </FormField>
      {!p.tipped && p.members.length > 0 && (
        <section className="mt-6 space-y-2">
          <h2 className="font-semibold">Tip your crew (optional)</h2>
          <p className="text-sm text-slate-500">Each person gets exactly what you enter. CSS covers the card fee.</p>
          {p.members.map((m) => (
            <div key={m.id} className="flex items-center justify-between gap-3">
              <span>
                {m.firstName} <span className="text-xs text-slate-500">({m.role})</span>
              </span>
              <div className="flex items-center gap-1">
                <span>$</span>
                <Input inputMode="decimal" className="w-24" value={tips[m.id] ?? ""} onChange={(e) => setTips({ ...tips, [m.id]: e.target.value })} />
              </div>
            </div>
          ))}
          {p.cardLast4 && <p className="text-xs text-slate-500">Charged to the card on file ending in {p.cardLast4}.</p>}
        </section>
      )}
      <Alert>{errorText(submit.error)}</Alert>
      <Button
        size="lg"
        className="mt-6 w-full"
        disabled={!rating}
        loading={submit.isPending}
        onClick={() =>
          submit.mutate({ token, rating, comment: comment || null, tips: p.tipped ? [] : p.members.map((m) => ({ employeeId: m.id, amountCents: parseDollars(tips[m.id] || "0") ?? 0 })) })
        }
      >
        {total > 0 && !p.tipped ? `Send rating and ${formatCents(total)} tip` : "Send rating"}
      </Button>
    </Shell>
  );
}
