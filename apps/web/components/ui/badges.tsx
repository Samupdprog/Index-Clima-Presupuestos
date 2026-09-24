import type { QuoteOrigin, QuoteStatus } from "../../lib/api/types";

const statuses: Record<QuoteStatus, { label: string; className: string }> = {
  draft: { label: "Borrador", className: "badge-draft" },
  ready_for_review: { label: "Listo para revisar", className: "badge-ready" },
  finalized: { label: "Finalizado", className: "badge-final" },
  archived: { label: "Archivado", className: "badge-archived" },
};

export function StatusBadge({ status }: { status: QuoteStatus }) {
  const item = statuses[status];
  return <span className={`badge ${item.className}`}>{item.label}</span>;
}

export function OriginBadge({ origin }: { origin: QuoteOrigin }) {
  return <span className="badge badge-origin">{origin === "holded" ? "Holded" : "Generador"}</span>;
}
