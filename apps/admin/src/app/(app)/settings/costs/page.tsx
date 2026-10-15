"use client";
/** Services & costs: every third-party tool the system uses, in plain English. */
import { useQuery } from "@tanstack/react-query";
import { Badge, Card } from "@css/ui/kit";
import { useTRPC } from "@css/ui/trpc";
import { PageHeader } from "../../../../components/page";

export default function Costs() {
  const trpc = useTRPC();
  const rows = useQuery(trpc.admin.config.servicesAndCosts.queryOptions()).data;
  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader title="Services & costs" subtitle="What each outside tool does for CSS, roughly what it costs, and what breaks without it." />
      {rows?.map((r) => (
        <Card key={r.tool} title={<span className="flex items-center gap-2">{r.tool} {r.live ? <Badge tone="green">connected</Badge> : <Badge>not connected (demo stand-in)</Badge>}</span>}>
          <p className="text-sm text-slate-700">{r.what}</p>
          <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase text-slate-500">Cost</dt>
              <dd>{r.cost}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-slate-500">Without it</dt>
              <dd>{r.breaksWithout}</dd>
            </div>
          </dl>
        </Card>
      ))}
    </div>
  );
}
