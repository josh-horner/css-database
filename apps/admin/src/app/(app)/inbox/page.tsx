"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { cx, formatCents } from "@css/ui";
import { useTRPC } from "@css/ui/trpc";

/** Conversations workspace: list | thread | context (docs/apps/admin.md). */
export default function InboxPage() {
  const trpc = useTRPC();
  const [filter, setFilter] = useState<"escalated" | "all">("escalated");
  const [selected, setSelected] = useState<string | null>(null);
  const list = useQuery(trpc.admin.conversations.list.queryOptions({ filter }, { refetchInterval: 3000 }));

  useEffect(() => {
    if (!selected && list.data?.[0]) setSelected(list.data[0].id);
  }, [list.data, selected]);

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Conversations</h1>
          <p className="text-sm text-slate-500">The assistant answers routine questions. You see what needs a person.</p>
        </div>
        <div className="flex rounded-md border border-slate-300 bg-white text-sm">
          {(["escalated", "all"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={cx("px-3 py-1.5", filter === f ? "bg-slate-800 text-white" : "text-slate-700")}>
              {f === "escalated" ? "Needs you" : "All"}
            </button>
          ))}
        </div>
      </header>
      <div className="grid gap-3 lg:grid-cols-[280px_minmax(0,1fr)_300px]">
        <ul className="max-h-[70vh] overflow-y-auto rounded-xl border border-slate-200 bg-white">
          {list.data?.length === 0 && <li className="p-4 text-sm text-slate-500">Nothing needs you right now.</li>}
          {list.data?.map((c) => (
            <li key={c.id}>
              <button onClick={() => setSelected(c.id)} className={cx("w-full border-b border-slate-100 px-3 py-2 text-left", selected === c.id && "bg-blue-50")}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{c.name ?? c.address}</span>
                  <StatusBadge status={c.status} />
                </div>
                <div className="truncate text-xs text-slate-500">{c.summary ?? c.lastMessage?.body}</div>
              </button>
            </li>
          ))}
        </ul>
        {selected ? <Thread id={selected} /> : <div className="rounded-xl border border-dashed border-slate-300 p-8 text-slate-500">Select a conversation</div>}
      </div>
      <SimulateInbound />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const style = status === "escalated" ? "bg-amber-100 text-amber-800" : status === "ai_handling" ? "bg-blue-100 text-blue-800" : "bg-slate-100 text-slate-600";
  const label = status === "escalated" ? "needs you" : status === "ai_handling" ? "AI" : "done";
  return <span className={cx("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", style)}>{label}</span>;
}

function Thread({ id }: { id: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const conv = useQuery(trpc.admin.conversations.get.queryOptions({ id }, { refetchInterval: 3000 }));
  const [body, setBody] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const invalidate = () => qc.invalidateQueries();
  const reply = useMutation(trpc.admin.conversations.reply.mutationOptions({ onSuccess: () => (setBody(""), invalidate()) }));
  const setStatus = useMutation(trpc.admin.conversations.setStatus.mutationOptions({ onSuccess: invalidate }));
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [conv.data?.messages.length]);
  const c = conv.data;
  if (!c) return <div className="rounded-xl border border-slate-200 bg-white p-4 text-slate-500">Loading…</div>;

  return (
    <>
      <section className="flex max-h-[70vh] min-h-[50vh] flex-col rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-2">
          <div className="font-medium">{c.person?.name ?? c.address}</div>
          {c.summary && <div className="text-sm text-slate-500">{c.summary}</div>}
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {c.messages.map((m) => (
            <div key={m.id} className={cx("flex", m.direction === "outbound" ? "justify-end" : "justify-start")}>
              <div
                className={cx(
                  "max-w-[80%] rounded-2xl px-3 py-2 text-sm",
                  m.direction === "inbound" ? "bg-slate-100" : m.author === "ai" ? "bg-violet-100 text-violet-950" : m.author === "staff" ? "bg-brand text-white" : "bg-sky-50 text-sky-950",
                )}
              >
                <div className="whitespace-pre-wrap">{m.body}</div>
                <div className="mt-1 text-[10px] opacity-70">
                  {m.direction === "inbound" ? "Customer" : m.author === "ai" ? "Assistant" : m.author === "staff" ? "You" : "Automatic"} ·{" "}
                  {new Date(m.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                </div>
              </div>
            </div>
          ))}
          <div ref={bottom} />
        </div>
        <form
          className="flex gap-2 border-t border-slate-100 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) reply.mutate({ id, body: body.trim(), resolve: true });
          }}
        >
          <input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Reply by text…" className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <button disabled={reply.isPending || !body.trim()} className="rounded-md bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
            Send &amp; resolve
          </button>
        </form>
      </section>
      <aside className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Customer</h3>
          {c.status === "escalated" ? (
            <button onClick={() => setStatus.mutate({ id, status: "resolved" })} className="rounded border border-slate-300 px-2 py-1 text-xs">Mark resolved</button>
          ) : null}
        </div>
        {c.context?.summary ? (
          <>
            <div>
              <div className="text-lg font-semibold">#{c.context.summary.confirmationNumber}</div>
              <div>{c.context.summary.name}</div>
              <div className="text-slate-500">{c.context.summary.lifecycle.replace("_", " ")} · balance {formatCents(c.context.summary.balanceCents)}</div>
            </div>
            <ul className="list-disc space-y-1 pl-4 text-slate-700">
              {c.context.facts.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
            {c.context.links.map((l) => (
              <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="block text-brand underline">
                Open {l.label.toLowerCase()} page
              </a>
            ))}
          </>
        ) : (
          <p className="text-slate-500">Unknown number. No booking matched.</p>
        )}
        {c.lastAi && (
          <div className="rounded-md bg-violet-50 p-2 text-xs text-violet-900">
            Assistant: intent <b>{c.lastAi.intent}</b>, confidence {Math.round(c.lastAi.confidence * 100)}%,{" "}
            {c.lastAi.autoSent ? "answered automatically" : `escalated (${c.lastAi.reason ?? "needs a person"})`}. Model: {c.lastAi.model}
          </div>
        )}
      </aside>
    </>
  );
}

/** Demo helper: pretend a customer texted CSS, for running without Twilio. */
function SimulateInbound() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [from, setFrom] = useState("+13035551103");
  const [body, setBody] = useState("Hey, when are you guys getting here?");
  const send = useMutation(trpc.admin.conversations.simulateInbound.mutationOptions({ onSuccess: () => qc.invalidateQueries() }));
  return (
    <details className="rounded-xl border border-dashed border-slate-300 bg-white p-3 text-sm">
      <summary className="cursor-pointer font-medium text-slate-600">Demo: simulate a customer text</summary>
      <form
        className="mt-2 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send.mutate({ from, body });
        }}
      >
        <input value={from} onChange={(e) => setFrom(e.target.value)} className="w-40 rounded border border-slate-300 px-2 py-1" />
        <input value={body} onChange={(e) => setBody(e.target.value)} className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1" />
        <button className="rounded bg-slate-800 px-3 py-1 text-white">Send</button>
      </form>
      <p className="mt-1 text-xs text-slate-500">Seeded customers: +13035551101 … +13035551106 (stop 1–6).</p>
    </details>
  );
}
