/**
 * Reports by any time frame (docs/apps/admin.md#new-capabilities): pick a range, a grouping, optional school,
 * and optionally compare with the same range last year. Everything is derived from rows; nothing is stored.
 */
import { TRPCError } from "@trpc/server";
import { sql, type DbOrTx, type SQL } from "@css/db";

export const REPORTS = {
  signups: { label: "Signups", groups: ["day", "week", "month", "school", "service", "heard_from", "signer"] },
  revenue: { label: "Revenue & payments", groups: ["day", "week", "month", "school", "provider"] },
  receivables: { label: "Balances owed (A/R)", groups: ["school", "status", "season"] },
  referrals: { label: "Referrals", groups: ["month", "via", "kind", "school"] },
  capacity: { label: "Capacity", groups: ["day", "week", "school"] },
  crews: { label: "Crews & employees", groups: ["employee", "crew", "day", "school", "type"] },
  tips: { label: "Tips", groups: ["employee", "day", "week"] },
  ratings: { label: "Ratings", groups: ["employee", "crew", "school"] },
  messages: { label: "Messages", groups: ["day", "week", "purpose", "channel"] },
  claims: { label: "Claims", groups: ["month", "kind", "status", "school"] },
  adhoc_lines: { label: "Ad-hoc invoice lines", groups: ["description", "month"] },
} as const;
export type ReportKind = keyof typeof REPORTS;

export interface ReportColumn {
  key: string;
  label: string;
  type: "text" | "number" | "money" | "percent" | "minutes";
}

export interface ReportResult {
  kind: ReportKind;
  title: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  totals: Record<string, number | null>;
  compare: { from: string; to: string } | null;
}

const DENVER = sql.raw(`'America/Denver'`);
const localDay = (col: SQL) => sql`(${col} at time zone ${DENVER})::date`;

function timeGroup(group: string, day: SQL): SQL {
  if (group === "day") return sql`to_char(${day}, 'YYYY-MM-DD')`;
  if (group === "week") return sql`to_char(date_trunc('week', ${day}), 'YYYY-MM-DD')`;
  return sql`to_char(${day}, 'YYYY-MM')`;
}

function shiftYear(d: string, years: number) {
  return `${Number(d.slice(0, 4)) + years}${d.slice(4)}`;
}

async function rows(db: DbOrTx, query: SQL): Promise<Record<string, unknown>[]> {
  return (await db.execute(query)) as unknown as Record<string, unknown>[];
}

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

export async function runReport(
  db: DbOrTx,
  input: { kind: ReportKind; from: string; to: string; groupBy: string; schoolId?: string | null; compareLastYear?: boolean },
): Promise<ReportResult> {
  const def = REPORTS[input.kind];
  if (!def) throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown report" });
  if (!(def.groups as readonly string[]).includes(input.groupBy)) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick a grouping" });
  if (input.from > input.to) throw new TRPCError({ code: "BAD_REQUEST", message: "Start must be before end" });
  const base = await build(db, input.kind, input.from, input.to, input.groupBy, input.schoolId ?? null);
  let compare: ReportResult["compare"] = null;
  if (input.compareLastYear && !["receivables"].includes(input.kind)) {
    const from = shiftYear(input.from, -1);
    const to = shiftYear(input.to, -1);
    const prior = await build(db, input.kind, from, to, input.groupBy, input.schoolId ?? null);
    compare = { from, to };
    const metric = base.columns.find((c) => c.type !== "text")!;
    const timeGrouped = ["day", "week", "month"].includes(input.groupBy);
    base.columns.push({ key: "last_year", label: `${metric.label} last year`, type: metric.type });
    for (const r of base.rows) {
      const key = timeGrouped ? shiftYear(String(r.group), -1) : r.group;
      const match = prior.rows.find((p) => p.group === key);
      r.last_year = match ? (match[metric.key] as number) : 0;
    }
    base.totals.last_year = prior.totals[metric.key] ?? 0;
  }
  return { kind: input.kind, title: def.label, ...base, compare };
}

async function build(db: DbOrTx, kind: ReportKind, from: string, to: string, group: string, schoolId: string | null) {
  const school = (col: SQL) => (schoolId ? sql`and ${col} = ${schoolId}` : sql``);
  let columns: ReportColumn[];
  let data: Record<string, unknown>[];

  switch (kind) {
    case "signups": {
      const day = localDay(sql`b.submitted_at`);
      const g =
        group === "school"
          ? sql`coalesce(s.short_name, 'No school')`
          : group === "service"
            ? sql`sv.name`
            : group === "heard_from"
              ? sql`coalesce(b.heard_from, 'Not asked')`
              : group === "signer"
                ? sql`case when exists (select 1 from booking_parties bp where bp.booking_id = b.id and 'signer' = any(bp.roles) and 'guardian' = any(bp.roles)) then 'Parent' when b.created_by_staff_id is not null then 'Staff' else 'Student / customer' end`
                : timeGroup(group, day);
      const joinService = group === "service" ? sql`join booking_services bs on bs.booking_id = b.id join services sv on sv.id = bs.service_id` : sql``;
      data = await rows(
        db,
        sql`select ${g} as "group", count(distinct b.id)::int as bookings,
              count(distinct b.id) filter (where b.entered_code is not null)::int as with_code
            from bookings b left join schools s on s.id = b.school_id ${joinService}
            where b.submitted_at is not null and b.lifecycle <> 'draft' and ${day} between ${from} and ${to} ${school(sql`b.school_id`)}
            group by 1 order by 1`,
      );
      columns = [
        { key: "group", label: label(group), type: "text" },
        { key: "bookings", label: "Bookings", type: "number" },
        { key: "with_code", label: "Used a code", type: "number" },
      ];
      break;
    }
    case "revenue": {
      const day = localDay(sql`p.created_at`);
      const g = group === "school" ? sql`coalesce(s.short_name, 'No school')` : group === "provider" ? sql`p.provider::text` : timeGroup(group, day);
      data = await rows(
        db,
        sql`select ${g} as "group",
              coalesce(sum(p.amount_cents) filter (where p.kind = 'charge'), 0)::int as charged,
              coalesce(sum(p.amount_cents) filter (where p.kind = 'refund'), 0)::int as refunded,
              coalesce(sum(case when p.kind = 'charge' then p.amount_cents else -p.amount_cents end), 0)::int as net,
              count(*) filter (where p.kind = 'charge')::int as payments
            from payments p join bookings b on b.id = p.booking_id left join schools s on s.id = b.school_id
            where p.status = 'succeeded' and ${day} between ${from} and ${to} ${school(sql`b.school_id`)}
            group by 1 order by 1`,
      );
      const failed = await rows(
        db,
        sql`select count(*)::int as n from payments p join bookings b on b.id = p.booking_id
            where p.status = 'failed' and ${day} between ${from} and ${to} ${school(sql`b.school_id`)}`,
      );
      columns = [
        { key: "group", label: label(group), type: "text" },
        { key: "payments", label: "Payments", type: "number" },
        { key: "charged", label: "Charged", type: "money" },
        { key: "refunded", label: "Refunded", type: "money" },
        { key: "net", label: "Net", type: "money" },
      ];
      data.push(...(n(failed[0]?.n) ? [{ group: "(declined attempts)", payments: n(failed[0]?.n), charged: 0, refunded: 0, net: 0 }] : []));
      break;
    }
    case "receivables": {
      // Balance per booking = issued invoice totals − settled charges + refunds − write-offs.
      const g = group === "school" ? sql`coalesce(s.short_name, 'No school')` : group === "season" ? sql`se.name` : sql`case when cc.status is not null then cc.status::text else 'balance due' end`;
      data = await rows(
        db,
        sql`with lines as (
              select i.booking_id, sum(case when l.kind = 'discount' then -l.quantity * l.unit_price_cents else l.quantity * l.unit_price_cents end) as owed
              from invoices i join invoice_lines l on l.invoice_id = i.id where i.status in ('issued', 'paid') group by 1),
            paid as (
              select booking_id, sum(case when kind = 'charge' then amount_cents else -amount_cents end) as paid
              from payments where status = 'succeeded' group by 1),
            wo as (select booking_id, sum(amount_cents) as wo from write_offs group by 1),
            bal as (
              select b.id, b.school_id, b.season_id, coalesce(lines.owed, 0) - coalesce(paid.paid, 0) - coalesce(wo.wo, 0) as balance
              from bookings b left join lines on lines.booking_id = b.id left join paid on paid.booking_id = b.id left join wo on wo.booking_id = b.id)
            select ${g} as "group", count(*)::int as bookings, sum(bal.balance)::int as owed
            from bal join bookings b on b.id = bal.id join seasons se on se.id = b.season_id left join schools s on s.id = b.school_id
              left join collections_cases cc on cc.booking_id = b.id and cc.status <> 'resolved'
            where bal.balance > 0 ${school(sql`b.school_id`)}
            group by 1 order by 3 desc`,
      );
      columns = [
        { key: "group", label: label(group), type: "text" },
        { key: "bookings", label: "Bookings", type: "number" },
        { key: "owed", label: "Owed", type: "money" },
      ];
      break;
    }
    case "referrals": {
      const day = localDay(sql`r.created_at`);
      const g = group === "via" ? sql`coalesce(r.via, 'code typed in')` : group === "kind" ? sql`r.kind` : group === "school" ? sql`coalesce(s.short_name, 'No school')` : timeGroup(group, day);
      data = await rows(
        db,
        sql`select ${g} as "group", count(*)::int as referrals, sum(r.referee_reward_cents + r.referrer_reward_cents)::int as rewards
            from referrals r join bookings b on b.id = r.referee_booking_id left join schools s on s.id = b.school_id
            where ${day} between ${from} and ${to} ${school(sql`b.school_id`)} group by 1 order by 1`,
      );
      columns = [
        { key: "group", label: label(group), type: "text" },
        { key: "referrals", label: "Referrals", type: "number" },
        { key: "rewards", label: "Rewards given", type: "money" },
      ];
      break;
    }
    case "capacity": {
      const day = sql`sd.date`;
      const g = group === "school" ? sql`s.short_name` : timeGroup(group, day);
      data = await rows(
        db,
        sql`select ${g} as "group", sum(sd.capacity)::int as capacity,
              sum((select count(*) from appointments a join bookings b on b.id = a.booking_id
                   where a.service_day_id = sd.id and a.cancelled_at is null and b.lifecycle <> 'cancelled'))::int as reserved,
              count(*) filter (where sd.blocked)::int as blocked
            from service_days sd join schools s on s.id = sd.school_id
            where sd.date between ${from} and ${to} ${school(sql`sd.school_id`)} group by 1 order by 1`,
      );
      for (const r of data) r.utilization = n(r.capacity) ? n(r.reserved) / n(r.capacity) : 0;
      columns = [
        { key: "group", label: label(group), type: "text" },
        { key: "capacity", label: "Capacity", type: "number" },
        { key: "reserved", label: "Reserved", type: "number" },
        { key: "utilization", label: "Full", type: "percent" },
        { key: "blocked", label: "Blocked windows", type: "number" },
      ];
      break;
    }
    case "crews": {
      const day = localDay(sql`j.completed_at`);
      const g =
        group === "employee"
          ? sql`e.first_name || ' ' || e.last_name`
          : group === "crew"
            ? sql`c.name || ' (' || c.date || ')'`
            : group === "school"
              ? sql`coalesce(s.short_name, 'No school')`
              : group === "type"
                ? sql`a.type::text`
                : timeGroup(group, day);
      const joinEmployee = group === "employee" ? sql`join crew_members cm on cm.crew_id = c.id join employees e on e.id = cm.employee_id` : sql``;
      data = await rows(
        db,
        sql`select ${g} as "group", count(distinct j.id)::int as jobs,
              count(distinct j.id) filter (where j.arrived_at is not null and to_char(j.arrived_at at time zone ${DENVER}, 'HH24:MI') <=
                case a.window_id when 'AM' then '12:30' when 'PM' then '16:30' else '16:30' end)::int as on_time,
              round(avg(extract(epoch from (j.completed_at - j.arrived_at)) / 60) filter (where j.arrived_at is not null))::int as minutes_per_stop,
              round(avg(cr.rating)::numeric, 2)::float as rating,
              count(cr.id)::int as ratings
            from jobs j join appointments a on a.id = j.appointment_id join bookings b on b.id = a.booking_id
              join crews c on c.id = j.crew_id left join schools s on s.id = b.school_id left join crew_ratings cr on cr.job_id = j.id ${joinEmployee}
            where j.status = 'completed' and ${day} between ${from} and ${to} ${school(sql`b.school_id`)}
            group by 1 order by 1`,
      );
      const hours =
        group === "employee"
          ? await rows(
              db,
              sql`select e.first_name || ' ' || e.last_name as "group",
                    round(sum(extract(epoch from (coalesce(t.clock_out_at, now()) - t.clock_in_at)) / 3600)::numeric, 1)::float as hours
                  from time_entries t join employees e on e.id = t.employee_id
                  where ${localDay(sql`t.clock_in_at`)} between ${from} and ${to} group by 1`,
            )
          : [];
      for (const r of data) {
        r.on_time_pct = n(r.jobs) ? n(r.on_time) / n(r.jobs) : 0;
        if (group === "employee") r.hours = hours.find((h) => h.group === r.group)?.hours ?? 0;
      }
      columns = [
        { key: "group", label: label(group), type: "text" },
        { key: "jobs", label: "Jobs done", type: "number" },
        { key: "on_time_pct", label: "On time", type: "percent" },
        { key: "minutes_per_stop", label: "Time per stop", type: "minutes" },
        { key: "rating", label: "Avg rating", type: "number" },
        { key: "ratings", label: "Ratings", type: "number" },
        ...(group === "employee" ? [{ key: "hours", label: "Hours clocked", type: "number" as const }] : []),
      ];
      break;
    }
    case "tips": {
      const day = localDay(sql`t.created_at`);
      const g = group === "employee" ? sql`e.first_name || ' ' || e.last_name` : timeGroup(group, day);
      data = await rows(
        db,
        sql`select ${g} as "group", count(*)::int as tips, sum((line->>'amountCents')::int)::int as amount
            from tips t cross join lateral jsonb_array_elements(t.lines) line join employees e on e.id = (line->>'employeeId')::uuid
            where ${day} between ${from} and ${to} and (line->>'amountCents')::int > 0 group by 1 order by 1`,
      );
      columns = [
        { key: "group", label: label(group), type: "text" },
        { key: "tips", label: "Tips", type: "number" },
        { key: "amount", label: "Amount", type: "money" },
      ];
      break;
    }
    case "ratings": {
      const day = localDay(sql`cr.created_at`);
      const g = group === "employee" ? sql`e.first_name || ' ' || e.last_name` : group === "crew" ? sql`c.name` : sql`coalesce(s.short_name, 'No school')`;
      const joinEmployee = group === "employee" ? sql`join crew_members cm on cm.crew_id = c.id join employees e on e.id = cm.employee_id` : sql``;
      data = await rows(
        db,
        sql`select ${g} as "group", count(*)::int as ratings, round(avg(cr.rating)::numeric, 2)::float as average,
              count(*) filter (where cr.rating <= 3)::int as low
            from crew_ratings cr join jobs j on j.id = cr.job_id join crews c on c.id = j.crew_id
              join appointments a on a.id = j.appointment_id join bookings b on b.id = a.booking_id left join schools s on s.id = b.school_id ${joinEmployee}
            where ${day} between ${from} and ${to} ${school(sql`b.school_id`)} group by 1 order by 1`,
      );
      columns = [
        { key: "group", label: label(group), type: "text" },
        { key: "ratings", label: "Ratings", type: "number" },
        { key: "average", label: "Average", type: "number" },
        { key: "low", label: "3 stars or fewer", type: "number" },
      ];
      break;
    }
    case "messages": {
      const day = localDay(sql`m.created_at`);
      const g = group === "purpose" ? sql`coalesce(m.purpose, case when m.direction = 'inbound' then 'customer message' else 'other' end)` : group === "channel" ? sql`m.channel::text` : timeGroup(group, day);
      data = await rows(
        db,
        sql`select ${g} as "group",
              count(*) filter (where m.direction = 'outbound')::int as sent,
              count(*) filter (where m.direction = 'inbound')::int as received,
              count(*) filter (where m.author = 'ai')::int as ai_answered,
              count(*) filter (where m.author = 'staff')::int as staff_replies
            from messages m where ${day} between ${from} and ${to} group by 1 order by 1`,
      );
      columns = [
        { key: "group", label: label(group), type: "text" },
        { key: "received", label: "From customers", type: "number" },
        { key: "ai_answered", label: "Answered by AI", type: "number" },
        { key: "staff_replies", label: "Answered by staff", type: "number" },
        { key: "sent", label: "All sent", type: "number" },
      ];
      break;
    }
    case "claims": {
      const day = localDay(sql`cl.created_at`);
      const g = group === "kind" ? sql`cl.kind` : group === "status" ? sql`cl.status::text` : group === "school" ? sql`coalesce(s.short_name, 'No school')` : timeGroup(group, day);
      data = await rows(
        db,
        sql`select ${g} as "group", count(*)::int as claims, coalesce(sum(cl.amount_cents), 0)::int as paid_out
            from claims cl join bookings b on b.id = cl.booking_id left join schools s on s.id = b.school_id
            where ${day} between ${from} and ${to} ${school(sql`b.school_id`)} group by 1 order by 1`,
      );
      columns = [
        { key: "group", label: label(group), type: "text" },
        { key: "claims", label: "Claims", type: "number" },
        { key: "paid_out", label: "Refunds/credits", type: "money" },
      ];
      break;
    }
    case "adhoc_lines": {
      const day = localDay(sql`l.created_at`);
      const g = group === "description" ? sql`lower(l.description)` : timeGroup(group, day);
      data = await rows(
        db,
        sql`select ${g} as "group", count(*)::int as lines, sum(l.quantity * l.unit_price_cents)::int as amount
            from invoice_lines l join invoices i on i.id = l.invoice_id join bookings b on b.id = i.booking_id
            where l.rate_card_item_id is null and l.kind = 'charge' and l.quantity > 0 and ${day} between ${from} and ${to} ${school(sql`b.school_id`)}
            group by 1 order by 2 desc`,
      );
      columns = [
        { key: "group", label: label(group), type: "text" },
        { key: "lines", label: "Times used", type: "number" },
        { key: "amount", label: "Amount", type: "money" },
      ];
      break;
    }
  }

  const out = data.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "string" || v === null ? v : Number(v)]))) as Record<string, string | number | null>[];
  const totals: Record<string, number | null> = {};
  for (const c of columns.filter((c) => c.type !== "text")) {
    if (c.type === "percent" || c.key === "rating" || c.key === "average" || c.key === "minutes_per_stop") totals[c.key] = null;
    else totals[c.key] = out.reduce((sum, r) => sum + n(r[c.key]), 0);
  }
  if (kind === "capacity" && totals.capacity) totals.utilization = n(totals.reserved) / n(totals.capacity);
  return { columns, rows: out, totals };
}

function label(group: string) {
  return (
    {
      day: "Day",
      week: "Week of",
      month: "Month",
      school: "School",
      service: "Service",
      heard_from: "Heard about us",
      signer: "Signed up by",
      provider: "Processor",
      status: "Status",
      season: "Season",
      via: "Shared via",
      kind: "Kind",
      employee: "Employee",
      crew: "Crew",
      type: "Job type",
      purpose: "Message",
      channel: "Channel",
      description: "Line",
    } as Record<string, string>
  )[group] ?? group;
}
