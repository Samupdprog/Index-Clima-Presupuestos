"use client";

import { Laptop, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export default function Page() {
  const { theme, setTheme } = useTheme(); const [mounted, setMounted] = useState(false); useEffect(() => setMounted(true), []);
  const themes = [{ value: "light", label: "Claro", description: "Superficies luminosas y contraste limpio.", icon: Sun }, { value: "dark", label: "Oscuro", description: "Entorno sobrio para trabajar con poca luz.", icon: Moon }, { value: "system", label: "Sistema", description: "Sigue la preferencia de este dispositivo.", icon: Laptop }];
  return <div className="page page-narrow"><div className="page-header"><div><p className="eyebrow">Preferencias</p><h1 className="page-title">Configuración</h1><p className="page-subtitle">Ajustes de interfaz para esta instalación. Holded e IA no están habilitados en esta fase.</p></div></div><section><h2 style={{ margin: "0 0 12px", fontSize: 16 }}>Apariencia</h2><div className="settings-grid">{themes.map((item) => { const Icon = item.icon; return <button key={item.value} className="panel setting-card" data-active={mounted && theme === item.value} onClick={() => setTheme(item.value)}><Icon /><h3>{item.label}</h3><p>{item.description}</p></button>; })}</div></section><div className="panel" style={{ marginTop: 24, padding: 20 }}><h2 style={{ margin: "0 0 7px", fontSize: 15 }}>Index Clima Presupuestos</h2><p style={{ margin: 0, color: "var(--foreground-muted)" }}>El motor económico y la persistencia viven en el backend. La interfaz nunca sustituye sus cálculos.</p></div></div>;
}
