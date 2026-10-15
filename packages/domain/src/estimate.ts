/**
 * Live estimate at signup and when staff add a service. Prices come only from the rate card (the same table
 * the invoice uses); storage itself is priced per item at pickup, so the estimate says so instead of guessing.
 */
import type { Cents } from "./money";
import { sumCents } from "./money";
import { isVisible, type FieldDef } from "./fields";

export interface PriceListItem {
  code: string;
  name: string;
  unitPriceCents: Cents;
}

export interface EstimateService {
  id: string;
  name: string;
  chargesDeposit: boolean;
  baseRateCardCode: string | null;
  fields: readonly FieldDef[];
}

export interface EstimateLine {
  serviceId: string | null;
  rateCardCode: string | null;
  description: string;
  quantity: number;
  unitPriceCents: Cents;
  kind: "charge" | "discount";
}

export interface Estimate {
  /** Charged at signup. */
  depositCents: Cents;
  /** Known charges billed after pickup/at service time. */
  lines: EstimateLine[];
  laterCents: Cents;
  /** True when items are priced per piece at pickup (storage). */
  itemsPricedAtPickup: boolean;
}

export function estimateBooking(input: {
  services: readonly EstimateService[];
  answers: Record<string, unknown>;
  priceList: readonly PriceListItem[];
  depositCents: Cents;
  discounts?: readonly { description: string; amountCents: Cents }[];
}): Estimate {
  const price = new Map(input.priceList.map((p) => [p.code, p]));
  const lines: EstimateLine[] = [];
  const add = (serviceId: string, code: string | null | undefined, quantity: number, description?: string) => {
    if (!code || quantity <= 0) return;
    const item = price.get(code);
    if (!item) return;
    lines.push({ serviceId, rateCardCode: code, description: description ?? item.name, quantity, unitPriceCents: item.unitPriceCents, kind: "charge" });
  };

  const askedOnce = new Set<string>();
  for (const service of input.services) {
    add(service.id, service.baseRateCardCode, 1);
    for (const field of service.fields) {
      if (askedOnce.has(field.key) || !isVisible(field, input.answers)) continue;
      askedOnce.add(field.key);
      const value = input.answers[field.key];
      if (field.type === "number" && typeof value === "number") add(service.id, field.config.rateCardCode, value);
      if (field.type === "yes_no" && value === true) add(service.id, field.config.rateCardCode, 1);
      if (field.type === "select" && typeof value === "string") {
        const option = field.config.options?.find((o) => o.value === value);
        add(service.id, option?.rateCardCode, 1);
      }
      if (field.type === "multi_select" && Array.isArray(value)) {
        for (const v of value) add(service.id, field.config.options?.find((o) => o.value === v)?.rateCardCode, 1);
      }
    }
  }
  for (const d of input.discounts ?? []) {
    lines.push({ serviceId: null, rateCardCode: null, description: d.description, quantity: 1, unitPriceCents: d.amountCents, kind: "discount" });
  }

  const deposit = input.services.some((s) => s.chargesDeposit) ? input.depositCents : 0;
  const laterCents = sumCents(lines.map((l) => (l.kind === "discount" ? -l.quantity * l.unitPriceCents : l.quantity * l.unitPriceCents)));
  return {
    depositCents: deposit,
    lines,
    laterCents,
    itemsPricedAtPickup: input.services.some((s) => s.chargesDeposit),
  };
}
