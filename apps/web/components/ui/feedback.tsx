"use client";

import { AnimatePresence, motion } from "motion/react";
import { AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";
import { useCallback, useState } from "react";
import { Dialog, DialogClose, DialogContent } from "../animate-ui/overlay";
import { RippleButton } from "../animate-ui/ripple-button";

export type ToastItem = { id: number; message: string; tone?: "success" | "error" };

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const push = useCallback((message: string, tone: ToastItem["tone"] = "success") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 3200);
  }, []);
  return { toasts, push };
}

export function ToastViewport({ toasts }: { toasts: ToastItem[] }) {
  return (
    <div className="toast-viewport" role="region" aria-label="Notificaciones">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.div
            className={`toast${toast.tone === "error" ? " toast-error" : ""}`}
            key={toast.id}
            initial={{ opacity: 0, y: 10, scale: .98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 16 }}
            role={toast.tone === "error" ? "alert" : "status"}
          >
            {toast.tone === "error" ? <AlertCircle /> : <CheckCircle2 />}
            <span>{toast.message}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function RevisionConflictDialog({ open, onOpenChange, onReload }: { open: boolean; onOpenChange: (open: boolean) => void; onReload: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="El presupuesto ha cambiado"
        description="Otra sesión guardó una versión más reciente. Para proteger esos cambios no hemos sobrescrito nada."
        footer={
          <>
            <DialogClose asChild><RippleButton variant="secondary">Cancelar</RippleButton></DialogClose>
            <RippleButton onClick={onReload}><RefreshCw />Recargar versión actual</RippleButton>
          </>
        }
      >
        <div className="notice notice-warning"><AlertCircle /><span>Los cambios que acabas de intentar guardar no se han aplicado.</span></div>
      </DialogContent>
    </Dialog>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="empty-state">
      <div><div className="empty-icon" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}><AlertCircle /></div>
      <h3>No hemos podido cargar esta vista</h3><p>{message}</p>
      {onRetry ? <RippleButton variant="secondary" onClick={onRetry}><RefreshCw />Reintentar</RippleButton> : null}</div>
    </div>
  );
}
