"use client";

import { Check, ChevronDown, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

export interface SearchableSelectOption {
  value: string;
  label: string;
  description?: string;
  keywords?: string;
}

export function SearchableSelect({
  id,
  value,
  options,
  onChange,
  placeholder = "Buscar y seleccionar…",
  emptyMessage = "No hay coincidencias",
  disabled = false,
  required = false,
  allowClear = true,
  clearLabel = "Quitar selección",
}: {
  id?: string;
  value: string;
  options: SearchableSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  required?: boolean;
  allowClear?: boolean;
  clearLabel?: string;
}) {
  const generatedId = useId();
  const inputId = id ?? `combobox-${generatedId}`;
  const listId = `${inputId}-listbox`;
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = options.find((option) => option.value === value);
  const [query, setQuery] = useState(selected?.label ?? "");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!open) setQuery(selected?.label ?? "");
  }, [open, selected?.label]);

  const filtered = useMemo(() => {
    const needle = normalize(query === selected?.label ? "" : query);
    if (!needle) return options;
    return options.filter((option) => normalize(`${option.label} ${option.description ?? ""} ${option.keywords ?? ""}`).includes(needle));
  }, [options, query, selected?.label]);

  useEffect(() => { setActiveIndex(0); }, [query]);

  function choose(option: SearchableSelectOption) {
    onChange(option.value);
    setQuery(option.label);
    setOpen(false);
    inputRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault(); setOpen(true); setActiveIndex((current) => Math.min(current + 1, Math.max(filtered.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault(); setOpen(true); setActiveIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter" && open && filtered[activeIndex]) {
      event.preventDefault(); choose(filtered[activeIndex]!);
    } else if (event.key === "Escape") {
      event.preventDefault(); setOpen(false); setQuery(selected?.label ?? "");
    }
  }

  return (
    <div className="combobox" data-disabled={disabled || undefined}>
      <Search className="combobox-search" aria-hidden="true" />
      <input
        ref={inputRef}
        id={inputId}
        className="input combobox-input"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && filtered[activeIndex] ? `${listId}-${activeIndex}` : undefined}
        value={query}
        placeholder={placeholder}
        disabled={disabled}
        required={required && !value}
        onFocus={(event) => { setOpen(true); event.currentTarget.select(); }}
        onBlur={() => window.setTimeout(() => { setOpen(false); setQuery(selected?.label ?? ""); }, 120)}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); if (!event.target.value && value) onChange(""); }}
        onKeyDown={handleKeyDown}
      />
      {allowClear && value && !disabled ? <button type="button" className="combobox-clear" aria-label={clearLabel} onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(""); setQuery(""); setOpen(true); inputRef.current?.focus(); }}><X /></button> : <ChevronDown className="combobox-chevron" aria-hidden="true" />}
      {open ? (
        <div id={listId} className="combobox-menu" role="listbox">
          {filtered.length ? filtered.map((option, index) => (
            <button
              id={`${listId}-${index}`}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className="combobox-option"
              data-active={index === activeIndex || undefined}
              key={option.value}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(option)}
            >
              <span><strong>{option.label}</strong>{option.description ? <small>{option.description}</small> : null}</span>
              {option.value === value ? <Check aria-hidden="true" /> : null}
            </button>
          )) : <p className="combobox-empty">{emptyMessage}</p>}
        </div>
      ) : null}
    </div>
  );
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}
