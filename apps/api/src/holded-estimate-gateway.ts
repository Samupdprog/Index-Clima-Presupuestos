import type { EstimateGateway } from "@quotes/application";
import { HoldedApiError, type HoldedClient } from "@quotes/holded";

function decimalFromHolded(value: unknown): string {
  const raw = typeof value === "number" ? String(value) : value;
  if (typeof raw !== "string" || !/^-?\d+(?:[.,]\d+)?$/.test(raw)) throw new HoldedApiError("invalid_response");
  return raw.replace(",", ".");
}

export function createHoldedEstimateGateway(client: HoldedClient): EstimateGateway {
  return {
    listTaxes: () => client.listTaxes(),
    saveEstimate: (input, id) => client.saveEstimate(input, id),
    async getEstimate(id) {
      const remote = await client.getEstimate(id);
      if (!Array.isArray(remote.lines)) throw new HoldedApiError("invalid_response");
      return {
        ...remote,
        subtotal: decimalFromHolded(remote.subtotal), tax: decimalFromHolded(remote.tax), total: decimalFromHolded(remote.total),
        lines: remote.lines.map((line) => ({ ...line, price: decimalFromHolded(line.price), units: decimalFromHolded(line.units), discount: decimalFromHolded(line.discount ?? "0"), tax: decimalFromHolded(line.tax ?? "0"), taxes: Array.isArray(line.taxes) ? line.taxes : [] })),
      };
    },
    async findEstimateByTag(tag, contactId) {
      let cursor: string | undefined;
      const cursors = new Set<string>();
      const matches = new Set<string>();
      for (let page = 0; ; page += 1) {
        if (page >= 1000) throw new HoldedApiError("invalid_response");
        const result = await client.listEstimatesPage({ contactId, ...(cursor ? { cursor } : {}) });
        for (const estimate of result.items) if (Array.isArray(estimate.tags) && estimate.tags.includes(tag)) matches.add(estimate.id);
        if (!result.has_more) break;
        if (!result.cursor || cursors.has(result.cursor)) throw new HoldedApiError("invalid_response");
        cursor = result.cursor;
        cursors.add(cursor);
      }
      if (matches.size > 1) throw new Error("holded_duplicate_estimates_found");
      return [...matches][0] ?? null;
    },
  };
}
