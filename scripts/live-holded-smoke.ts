/** Explicit live smoke: creates only uniquely named TEST entities and cleans them up. Run inside the API container. */
import assert from "node:assert/strict";
import { createHash, createDecipheriv, randomUUID } from "node:crypto";
import pg from "pg";
import { createHoldedClient } from "../packages/holded/src/client.js";
import { mergeLocalChangesIntoHoldedContact } from "../packages/holded/src/mapping.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const installationId = process.env.INSTALLATION_ID!;
const row = await pool.query("SELECT config FROM installations WHERE id = $1", [installationId]);
const config = row.rows[0]?.config?.holded ?? {};
let key = process.env.HOLDED_API_KEY;
if (config.apiKeyEncrypted) {
  const raw = Buffer.from(config.apiKeyEncrypted, "base64");
  const material = process.env.HOLDED_ENCRYPTION_KEY?.trim() || process.env.INTERNAL_SERVICE_TOKEN?.trim() || process.env.DATABASE_URL?.trim() || installationId;
  const cipher = createDecipheriv("aes-256-gcm", createHash("sha256").update(material).digest(), raw.subarray(0, 12));
  cipher.setAuthTag(raw.subarray(12, 28)); key = Buffer.concat([cipher.update(raw.subarray(28)), cipher.final()]).toString();
}
assert(key && !config.disconnected, "Holded must be connected");
const holded = createHoldedClient({ apiKey: key });
const prefix = `TEST CIERRE ${randomUUID().slice(0, 8)}`;
const createdClients: Array<{ id: string; remote?: string }> = [];
let quoteId: string | undefined, estimateId: string | undefined;
const results: string[] = [];
async function api(path: string, method = "GET", body?: unknown): Promise<any> {
  const response = await fetch(`http://127.0.0.1:4000${path}`, { method, headers: { authorization: `Bearer ${process.env.INTERNAL_SERVICE_TOKEN}`, "content-type": "application/json", "x-actor-type": "user", "x-actor-id": "live-smoke" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json() as any;
  assert(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
  return data;
}
try {
  let client = await api("/clients", "POST", { name: prefix, email: `${prefix.split(" ").at(-1)}@example.test`, phone: "999123000" });
  createdClients.push({ id: client.id, remote: client.holdedContactId });
  assert.equal(client.syncStatus, "synced", `create sync: ${client.syncError}`);
  assert(client.holdedContactId);
  let remote = await holded.getContact(client.holdedContactId);
  assert.equal(remote.name, prefix); results.push("create Generador → Holded");
  client = await api(`/clients/${client.id}`, "PATCH", { expectedRevision: client.revision, name: `${prefix} EDIT`, phone: "999123001", email: `${prefix.split(" ").at(-1)}-edit@example.test` });
  assert.equal(client.syncStatus, "synced", `edit sync: ${client.syncError}`);
  remote = await holded.getContact(client.holdedContactId);
  assert.equal(remote.name, `${prefix} EDIT`); assert.equal(remote.phone, "999123001"); assert.equal(remote.email, client.email); results.push("edit Generador → Holded (GET verified)");
  await holded.updateContact(client.holdedContactId, mergeLocalChangesIntoHoldedContact(remote, { name: `${prefix} REMOTE`, phone: "999123002" }));
  client = await api(`/clients/${client.id}/sync`, "POST", { expectedRevision: client.revision });
  assert.equal(client.name, `${prefix} REMOTE`); assert.equal(client.phone, "999123002"); results.push("edit Holded → Generador");
  const search = await api(`/clients?q=${encodeURIComponent(prefix)}`);
  assert.equal(search.filter((item: any) => item.holdedContactId === client.holdedContactId).length, 1); results.push("search repeat does not duplicate");
  if (process.env.SMOKE_CLIENTS_ONLY !== "true") {
  const taxes = await holded.listTaxes(); assert(taxes.length > 0, "No tax definitions");
  let quote = await api("/quotes", "POST", { title: prefix, clientId: client.id }); quoteId = quote.id;
  await api(`/quotes/${quoteId}/commands`, "POST", { type: "importQuoteLines", expectedRevision: quote.revision, lines: ["1283.94", "1260", "1159.20", "1283.94", "762.30"].map((directUnitCost, i) => ({ description: `${prefix} Machine ${i + 1}`, type: "material", quantity: "1", directUnitCost, igicRate: "7" })) });
  quote = await api(`/quotes/${quoteId}`);
  assert.equal(quote.calculation.saleWithoutTax, "5749.38");
  const adjustment = { expectedRevision: quote.revision, scope: "quote", mode: "amount", value: "300" };
  const preview = await api(`/quotes/${quoteId}/adjustments/preview`, "POST", adjustment);
  assert.equal(preview.totals.saleAfter, "6049.38");
  await api(`/quotes/${quoteId}/commands`, "POST", { ...adjustment, type: "addPriceAdjustment" });
  quote = await api(`/quotes/${quoteId}`); assert.equal(quote.calculation.saleWithoutTax, "6049.38"); results.push("five machines + backend preview/apply");
  try { quote = await api(`/quotes/${quoteId}/holded`, "POST", { expectedRevision: quote.revision }); }
  catch (error) {
    const failed = await api(`/quotes/${quoteId}`);
    console.error("Export diagnostic", JSON.stringify({ error: failed.holdedSyncError, status: failed.holdedSyncStatus, id: failed.holdedEstimateId }));
    if (failed.holdedEstimateId) {
      const remote = await holded.getEstimate(failed.holdedEstimateId);
      console.error("Remote response shape", JSON.stringify({ keys: Object.keys(remote), firstLine: Array.isArray(remote.lines) ? remote.lines[0] : null, firstItem: Array.isArray(remote.items) ? remote.items[0] : null }));
    }
    throw error;
  }
  estimateId = quote.holdedEstimateId;
  assert(estimateId); assert.equal(quote.holdedSyncStatus, "synced");
  const estimate = await holded.getEstimate(estimateId!);
  assert.equal(estimate.subtotal.replace(",", "."), quote.calculation.saleWithoutTax); assert.equal(estimate.tax.replace(",", "."), quote.calculation.taxTotal); assert.equal(estimate.total.replace(",", "."), quote.calculation.saleWithTax);
  results.push(`Estimate v2 created; sales=${quote.calculation.saleWithoutTax}; IGIC=${quote.calculation.taxTotal}; total=${quote.calculation.saleWithTax}`);
  quote = await api(`/quotes/${quoteId}/holded`, "POST", { expectedRevision: quote.revision }); assert.equal(quote.holdedEstimateId, estimateId); results.push("Estimate update/retry keeps same ID");
  await holded.deleteEstimate(estimateId!); estimateId = undefined;
  }
  client = await api(`/clients/${client.id}`);
  await api(`/clients/${client.id}`, "DELETE", { expectedRevision: client.revision, deleteFromHolded: true });
  await assert.rejects(holded.getContact(client.holdedContactId), (error: any) => error.status === 404); results.push("delete Generador → Holded and local archive");
  let second = await api("/clients", "POST", { name: `${prefix} DELETE REMOTE` });
  createdClients.push({ id: second.id, remote: second.holdedContactId }); assert(second.holdedContactId);
  await holded.deleteContact(second.holdedContactId);
  second = await api(`/clients/${second.id}/sync`, "POST", { expectedRevision: second.revision }); assert(second.deletedAt);
  assert(!(await api(`/clients?q=${encodeURIComponent(prefix)}`)).some((item: any) => item.id === second.id)); results.push("delete Holded → inactive local");
  console.log(JSON.stringify({ passed: results, quoteId, cleanup: "TEST entities only" }, null, 2));
} finally {
  if (quoteId) {
    const quote = await api(`/quotes/${quoteId}`).catch(() => null);
    const remoteId = estimateId ?? quote?.holdedEstimateId;
    if (remoteId) await holded.deleteEstimate(remoteId).catch((error: any) => { if (error.status !== 404) console.error("TEST estimate cleanup failed", remoteId, error.code); });
    if (quote && quote.status !== "archived") await api(`/quotes/${quoteId}/commands`, "POST", { type: "archiveQuote", expectedRevision: quote.revision }).catch(() => console.error("TEST quote archive failed", quoteId));
  }
  for (const created of createdClients) {
    const client = await api(`/clients/${created.id}`).catch(() => null);
    if (client && !client.deletedAt) await api(`/clients/${created.id}`, "DELETE", { expectedRevision: client.revision, deleteFromHolded: true }).catch(() => console.error("TEST client cleanup failed", created.id));
  }
  await pool.end();
}
