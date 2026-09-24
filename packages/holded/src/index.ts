export * from "./contracts.js";
export * from "./errors.js";
export * from "./mapping.js";
export * from "./client.js";

// Compatibilidad con la exportación de presupuestos existente.
export type { LegacyEstimateInput as HoldedEstimateInput, LegacyEstimateItem as HoldedEstimateItem } from "./client.js";

/** Enmascara una API key para mostrarla sin exponerla (nunca la clave completa). */
export function maskApiKey(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.length <= 4) return "•".repeat(Math.max(trimmed.length, 4));
  return `••••••••••••${trimmed.slice(-4)}`;
}
