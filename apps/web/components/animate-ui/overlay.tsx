"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { createContext, useContext, useState, type ComponentProps, type ReactNode } from "react";
import { X } from "lucide-react";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  children,
  title,
  description,
  wide = false,
  footer,
}: {
  children: ReactNode;
  title: string;
  description?: string;
  wide?: boolean;
  footer?: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay asChild>
        <motion.div
          className="dialog-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.18 }}
        />
      </DialogPrimitive.Overlay>
      <DialogPrimitive.Content asChild>
        <motion.div
          className={`dialog-content${wide ? " dialog-wide" : ""}`}
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.99 }}
          transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 330, damping: 30 }}
        >
          <div className="dialog-header">
            <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
            {description ? <DialogPrimitive.Description>{description}</DialogPrimitive.Description> : null}
          </div>
          <div className="dialog-body">{children}</div>
          {footer ? <div className="dialog-footer">{footer}</div> : null}
          <DialogPrimitive.Close className="button button-ghost button-icon dialog-close" aria-label="Cerrar">
            <X />
          </DialogPrimitive.Close>
        </motion.div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

type SheetRootProps = ComponentProps<typeof DialogPrimitive.Root>;
const SheetStateContext = createContext(false);

export function Sheet({ open, defaultOpen, onOpenChange, ...props }: SheetRootProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen ?? false);
  const current = open ?? internalOpen;
  const change = (next: boolean) => {
    if (open === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };
  return <SheetStateContext.Provider value={current}><DialogPrimitive.Root open={current} onOpenChange={change} {...props} /></SheetStateContext.Provider>;
}
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export function SheetContent({
  children,
  title,
  description,
  footer,
}: {
  children: ReactNode;
  title: string;
  description?: string;
  footer?: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const open = useContext(SheetStateContext);
  return (
    <AnimatePresence>
      {open ? <DialogPrimitive.Portal forceMount>
        <DialogPrimitive.Overlay asChild forceMount>
          <motion.div
            className="sheet-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.18 }}
          />
        </DialogPrimitive.Overlay>
        <DialogPrimitive.Content asChild forceMount>
          <motion.aside
            className="sheet-content"
            initial={reduceMotion ? { opacity: 0 } : { x: "100%", opacity: 0.6 }}
            animate={{ x: 0, opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { x: "100%", opacity: 0.6 }}
            transition={{ type: "spring", stiffness: 260, damping: 30, bounce: 0 }}
            style={{ position: "fixed", insetBlock: 0, right: 0 }}
          >
            <div className="sheet-header">
              <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
              {description ? <DialogPrimitive.Description>{description}</DialogPrimitive.Description> : null}
            </div>
            <div className="sheet-body">{children}</div>
            {footer ? <div className="sheet-footer">{footer}</div> : null}
            <DialogPrimitive.Close className="button button-ghost button-icon sheet-close" aria-label="Cerrar panel">
              <X />
            </DialogPrimitive.Close>
          </motion.aside>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal> : null}
    </AnimatePresence>
  );
}
