import { calcLineItemNet, calcQuoteTotals } from '@quotebot/shared';

export interface LineItemInput {
  quantity: number;
  unitCostPence: number;
  markupPct: number;
  labourMinutes: number;
  labourRatePence: number;
}

export function computeLineItemNet(item: LineItemInput): number {
  return calcLineItemNet(item);
}

export function computeQuoteTotals(
  lineItems: LineItemInput[],
  vatPct: number
) {
  return calcQuoteTotals({ lineItems, vatPct });
}
