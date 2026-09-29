"use client";

import type { InputHTMLAttributes } from "react";
import { formatDecimalForInput, parseDecimalText } from "../../lib/decimal";

type DecimalInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "inputMode"> & {
  value: string;
  onValueChange: (value: string) => void;
};

/**
 * Campo decimal: acepta coma o punto (13,96 · 13.96 · 1.234,50) y al salir lo muestra
 * normalizado sin ceros inútiles. Solo presentación: quien envía a la API usa `decimalForApi`.
 */
export function DecimalInput({ value, onValueChange, onBlur, ...props }: DecimalInputProps) {
  const invalid = value.trim() !== "" && parseDecimalText(value) === null;
  return (
    <input
      {...props}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={value}
      aria-invalid={invalid || undefined}
      onChange={(event) => onValueChange(event.target.value)}
      onBlur={(event) => {
        const formatted = formatDecimalForInput(value);
        if (formatted && formatted !== value) onValueChange(formatted);
        onBlur?.(event);
      }}
    />
  );
}
