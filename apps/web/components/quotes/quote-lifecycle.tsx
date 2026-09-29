"use client";

import { Archive, ArchiveRestore, Hash, LoaderCircle, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Dialog, DialogClose, DialogContent } from "../animate-ui/overlay";
import { RippleButton } from "../animate-ui/ripple-button";
import { api, ApiError } from "../../lib/api/client";
import type { QuoteRecord } from "../../lib/api/types";

export type LifecycleAction = "rename" | "archive" | "trash" | "restore" | "delete";

/** Un borrador nunca enviado a Holded o un presupuesto ya en la papelera puede eliminarse definitivamente. */
export function canDeletePermanently(quote: QuoteRecord) {
  return Boolean(quote.deletedAt) || (!quote.holdedEstimateId && !quote.holdedLastSyncedAt);
}

const COPY: Record<LifecycleAction, { title: string; confirm: string }> = {
  rename: { title: "Cambiar número del presupuesto", confirm: "Guardar número" },
  archive: { title: "Archivar presupuesto", confirm: "Archivar" },
  trash: { title: "Mover a la papelera", confirm: "Mover a la papelera" },
  restore: { title: "Restaurar presupuesto", confirm: "Restaurar" },
  delete: { title: "Eliminar definitivamente", confirm: "Eliminar definitivamente" },
};

function errorMessage(cause: unknown) {
  if (!(cause instanceof ApiError)) return "No se pudo completar la acción.";
  if (cause.isRevisionConflict) return "El presupuesto ha cambiado. Recarga y vuelve a intentarlo.";
  if (cause.code === "quote_reference_taken") return "Ya existe otro presupuesto con ese número.";
  if (cause.code === "invalid_input") return "El número solo admite letras, números, espacios y . _ / - (máx. 40).";
  if (cause.code === "quote_delete_requires_trash") return "Este presupuesto ya se envió a Holded: muévelo primero a la papelera.";
  if (cause.code === "quote_read_only") return "El presupuesto está archivado o en la papelera.";
  return "No se pudo completar la acción.";
}

/**
 * Diálogo de confirmación para las acciones de ciclo de vida. El backend valida siempre
 * revisión, unicidad del número y si el borrado definitivo está permitido.
 */
export function QuoteLifecycleDialog({ quote, action, onClose, onDone }: { quote: QuoteRecord | null; action: LifecycleAction | null; onClose: () => void; onDone: (result: { action: LifecycleAction; quote?: QuoteRecord }) => void }) {
  const [reference, setReference] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open = Boolean(quote && action);

  useEffect(() => {
    if (!open) return;
    setReference(quote?.reference ?? "");
    setTyped("");
    setError("");
    setBusy(false);
  }, [open, quote]);

  if (!quote || !action) return <Dialog open={false}><></></Dialog>;
  const current = quote;
  const kind = action;
  const linked = Boolean(current.holdedEstimateId);
  const blocked = kind === "delete" ? typed.trim() !== current.reference : kind === "rename" ? !reference.trim() || reference.trim() === current.reference : false;

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (blocked) return;
    setBusy(true);
    setError("");
    try {
      if (kind === "rename") onDone({ action: kind, quote: await api.changeQuoteReference(current.id, current.revision, reference.trim()) });
      if (kind === "archive") onDone({ action: kind, quote: await api.archiveQuote(current.id, current.revision) });
      if (kind === "trash") onDone({ action: kind, quote: await api.trashQuote(current.id, current.revision) });
      if (kind === "restore") onDone({ action: kind, quote: await api.restoreQuote(current.id, current.revision) });
      if (kind === "delete") { await api.deleteQuotePermanently(current.id, current.revision); onDone({ action: kind }); }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  const Icon = kind === "rename" ? Hash : kind === "archive" ? Archive : kind === "restore" ? ArchiveRestore : Trash2;
  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent
        title={COPY[kind].title}
        description={`${current.reference} · ${current.title}`}
        footer={<>
          <DialogClose asChild><RippleButton variant="secondary">Cancelar</RippleButton></DialogClose>
          <RippleButton variant={kind === "delete" || kind === "trash" ? "danger" : "primary"} disabled={busy || blocked} onClick={() => void submit()}>
            {busy ? <LoaderCircle className="spin" /> : <Icon />}{COPY[kind].confirm}
          </RippleButton>
        </>}
      >
        <form className="lifecycle-dialog" onSubmit={(event) => void submit(event)}>
          {kind === "rename" ? <>
            <label className="field"><span className="field-label">Nuevo número</span><input className="input" value={reference} maxLength={40} autoFocus onChange={(event) => setReference(event.target.value)} /></label>
            <p className="field-hint">Debe ser único. Es el número que verá el cliente en el documento.</p>
            {linked ? <div className="notice notice-warning"><TriangleAlert /><span>Está vinculado con Holded. La próxima sincronización actualizará el <strong>mismo documento</strong> con el nuevo número; no se creará otro.</span></div> : null}
          </> : null}
          {kind === "archive" ? <p className="dialog-text">Podrás seguir consultándolo, pero quedará en solo lectura. No se eliminan datos.</p> : null}
          {kind === "trash" ? <p className="dialog-text">Se oculta del listado y queda en solo lectura. Puedes restaurarlo desde la papelera.{linked ? " El presupuesto de Holded no se modifica." : ""}</p> : null}
          {kind === "restore" ? <p className="dialog-text">Vuelve al listado con su estado anterior y podrás editarlo de nuevo.</p> : null}
          {kind === "delete" ? <>
            <div className="notice notice-danger"><TriangleAlert /><span>Esta acción <strong>no se puede deshacer</strong>. Se eliminan las líneas, textos, ajustes y cálculos locales. {linked ? "El presupuesto de Holded NO se borra." : "Nunca se ha enviado a Holded."} El registro de auditoría se conserva.</span></div>
            <label className="field"><span className="field-label">Escribe <strong>{current.reference}</strong> para confirmar</span><input className="input" value={typed} autoFocus autoComplete="off" onChange={(event) => setTyped(event.target.value)} /></label>
          </> : null}
          {error ? <p className="error-text" role="alert">{error}</p> : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}
