"use client";

import { motion, useReducedMotion, type HTMLMotionProps } from "motion/react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";

type Ripple = { id: number; x: number; y: number };
const RippleContext = createContext<Ripple[]>([]);

export type RippleButtonProps = Omit<HTMLMotionProps<"button">, "children"> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "default" | "sm" | "icon";
  children?: ReactNode;
};

export function RippleButton({
  variant = "primary",
  size = "default",
  className = "",
  children,
  onClick,
  ...props
}: RippleButtonProps) {
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const sequence = useRef(0);
  const reduceMotion = useReducedMotion();

  const handleClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    if (!reduceMotion) {
      const rect = event.currentTarget.getBoundingClientRect();
      const ripple = {
        id: ++sequence.current,
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      setRipples((current) => [...current, ripple]);
      window.setTimeout(() => setRipples((current) => current.filter((item) => item.id !== ripple.id)), 620);
    }
    onClick?.(event);
  }, [onClick, reduceMotion]);

  return (
    <RippleContext.Provider value={ripples}>
      <motion.button
        className={`button button-${variant} ${size !== "default" ? `button-${size}` : ""} ${className}`.trim()}
        {...(!reduceMotion ? { whileTap: { scale: 0.975 } } : {})}
        transition={{ duration: 0.12 }}
        onClick={handleClick}
        {...props}
      >
        {children}
        <RippleButtonRipples />
      </motion.button>
    </RippleContext.Provider>
  );
}

export function RippleButtonRipples({ children }: { children?: ReactNode }) {
  const ripples = useContext(RippleContext);
  return (
    <>
      {ripples.map((ripple) => (
        <motion.span
          aria-hidden="true"
          key={ripple.id}
          initial={{ scale: 0, opacity: 0.42 }}
          animate={{ scale: 12, opacity: 0 }}
          transition={{ duration: 0.58, ease: "easeOut" }}
          style={{
            position: "absolute",
            pointerEvents: "none",
            width: 18,
            height: 18,
            left: ripple.x - 9,
            top: ripple.y - 9,
            borderRadius: "50%",
            background: "var(--ripple-button-ripple-color)",
          }}
        />
      ))}
      {children}
    </>
  );
}

export function buttonClass(variant: RippleButtonProps["variant"] = "primary", size: RippleButtonProps["size"] = "default") {
  return `button button-${variant} ${size !== "default" ? `button-${size}` : ""}`;
}
