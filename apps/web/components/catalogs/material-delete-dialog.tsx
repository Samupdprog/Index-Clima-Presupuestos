"use client";

import { LoaderCircle, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Dialog, DialogClose, DialogContent } from "../animate-ui/overlay";
import { RippleButton } from "../animate-ui/ripple-button";
import { api, ApiError } from "../../lib/api/client";
import type { CatalogRecord } from "../../lib/api/types";

/**
 * Confirmación del borrado definitivo de un material. Los presupuestos no dependen del
 * catálogo (cada línea guarda su copia), así que borrar no cambia ningún presupuesto.
 */
export function MaterialDeleteDialog({ material, onClose, onDeleted }: { material: CatalogRecord | null; onClose: () => void; onDeleted: (result: { name: string; usedInQuoteLines: number }) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open = Boolean(material);

  useEffect(() => {
    if (open) { setBusy(false); setError(""); }
  }, [open]);

  if (!material) return <Dialog open={false}><></></Dialog>;
  const current = material;
  const name = "name" in current ? current.name : "";

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      const result = await api.deleteMaterial(current.id);
      onDeleted({ name: result.name, usedInQuoteLines: result.usedInQuoteLines });
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 404 ? "Este material ya no existe. Recarga la página." : "No se pudo eliminar el material.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent
        title="Eliminar material"
        description={name}
        footer={<>
          <DialogClose asChild><RippleButton variant="secondary">Cancelar</RippleButton></DialogClose>
          <RippleButton variant="danger" disabled={busy} onClick={() => void confirm()}>
            {busy ? <LoaderCircle className="spin" /> : <Trash2 />}Eliminar definitivamente
          </RippleButton>
        </>}
      >
        <div className="lifecycle-dialog">
          <div className="notice notice-danger"><TriangleAlert /><span>Se borrará del catálogo <strong>para siempre</strong>. No se puede deshacer.</span></div>
          <p className="dialog-text">Los presupuestos que ya lo usan <strong>no cambian</strong>: cada línea guarda su propia copia del nombre, el coste y el precio. Si solo quieres que deje de aparecer al añadir líneas, usa «Desactivar».</p>
          {error ? <p className="error-text" role="alert">{error}</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
