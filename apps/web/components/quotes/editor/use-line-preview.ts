"use client";

import { useEffect, useState } from "react";
import type { QuoteCommand } from "@quotes/contracts";
import { api, ApiError } from "../../../lib/api/client";

type Result = Awaited<ReturnType<typeof api.previewLine>>;
export function useLinePreview(quoteId: string, command: QuoteCommand | null) {
  const key = command ? JSON.stringify(command) : "";
  const [state, setState] = useState<{ key: string; result?: Result; error?: string }>({ key: "" });
  useEffect(() => {
    if (!key) return;
    let stale = false;
    const timer = window.setTimeout(() => {
      void api.previewLine(quoteId, JSON.parse(key) as QuoteCommand).then((result) => {
        if (!stale) setState({ key, result });
      }).catch((error: unknown) => {
        if (!stale) setState({ key, error: error instanceof ApiError && error.isRevisionConflict ? "El presupuesto ha cambiado. Recarga antes de continuar." : "Completa los datos para calcular el precio en el servidor." });
      });
    }, 250);
    return () => { stale = true; clearTimeout(timer); };
  }, [quoteId, key]);
  return { result: state.key === key ? state.result : undefined, error: state.key === key ? state.error : undefined, pending: Boolean(key && state.key !== key) };
}
