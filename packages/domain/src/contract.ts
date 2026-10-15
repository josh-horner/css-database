/**
 * The crew's digital contract (docs/apps/crew.md): each line is a rate card item or "Other", a quantity,
 * and photos. Code prices it from the rate card; nobody (and no model) types a price for a rate card item.
 */
import type { Cents } from "./money";
import type { LedgerLine } from "./ledger";

export interface RateCardItem {
  id: string;
  code: string;
  name: string;
  unitPriceCents: Cents;
  active: boolean;
}

export interface ContractLine {
  rateCardItemId: string | null;
  /** Required for "Other" lines. */
  description: string | null;
  quantity: number;
}

export interface DraftInvoiceLine extends LedgerLine {
  rateCardItemId: string | null;
  description: string;
  /** "Other" lines have no price until the owner sets one during review. */
  needsPrice: boolean;
}

export class ContractError extends Error {}

export function validateContractLine(line: ContractLine): void {
  if (!Number.isInteger(line.quantity) || line.quantity < 1) throw new ContractError("Quantity must be at least 1");
  if (!line.rateCardItemId && !line.description?.trim()) throw new ContractError('"Other" items need a description');
}

export function priceContract(lines: readonly ContractLine[], rateCard: readonly RateCardItem[]): DraftInvoiceLine[] {
  const byId = new Map(rateCard.map((i) => [i.id, i]));
  return lines.map((line) => {
    validateContractLine(line);
    if (!line.rateCardItemId) {
      return {
        kind: "charge",
        rateCardItemId: null,
        description: line.description!.trim(),
        quantity: line.quantity,
        unitPriceCents: 0,
        needsPrice: true,
      };
    }
    const item = byId.get(line.rateCardItemId);
    if (!item) throw new ContractError(`Unknown rate card item ${line.rateCardItemId}`);
    return {
      kind: "charge",
      rateCardItemId: item.id,
      description: line.description?.trim() ? `${item.name}: ${line.description.trim()}` : item.name,
      quantity: line.quantity,
      unitPriceCents: item.unitPriceCents,
      needsPrice: false,
    };
  });
}

/** An invoice can be approved only when every line has a price. */
export function readyToApprove(lines: readonly Pick<DraftInvoiceLine, "needsPrice" | "unitPriceCents">[]): boolean {
  return lines.length > 0 && lines.every((l) => !l.needsPrice && l.unitPriceCents >= 0);
}
