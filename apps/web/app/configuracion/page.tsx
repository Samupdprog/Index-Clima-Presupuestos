"use client";

import { CheckCircle2, Clock3, Laptop, Moon, ShieldCheck, Sun, TriangleAlert } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { api, type HoldedSettingsResponse } from "../../lib/api/client";

const HOLD_INTERVAL_OPTIONS = [1, 5, 10, 15, 30, 60];

export default function Page() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [settings, setSettings] = useState<HoldedSettingsResponse | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [checkIntervalMinutes, setCheckIntervalMinutes] = useState(5);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const result = await api.getHoldedSettings();
        setSettings(result);
        setCheckIntervalMinutes(result.checkIntervalMinutes);
        setApiKeyInput("");
      } catch (e) {
        setError("No se pudieron cargar los ajustes de Holded.");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  useEffect(() => {
    if (!settings) return;
    const timer = window.setInterval(() => {
      void api.getHoldedSettings().then((result) => {
        setSettings(result);
        setCheckIntervalMinutes(result.checkIntervalMinutes);
      }).catch(() => {
        // Keep the last known health state visible if the API is temporarily unavailable.
      });
    }, settings.checkIntervalMinutes * 60_000);
    return () => window.clearInterval(timer);
  }, [settings?.checkIntervalMinutes]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const payload: { apiKey?: string; checkIntervalMinutes?: number } = {};
      if (apiKeyInput.trim()) payload.apiKey = apiKeyInput.trim();
      if (checkIntervalMinutes !== settings?.checkIntervalMinutes) payload.checkIntervalMinutes = checkIntervalMinutes;
      const result = await api.updateHoldedSettings(payload);
      setSettings(result);
      setApiKeyInput("");
      setMessage(result.isConfigured ? "Configuración guardada correctamente." : "Se guardó la configuración del intervalo. Añade la clave para activarlo.");
    } catch (e) {
      setError("No se pudo guardar la configuración de Holded.");
    } finally {
      setSaving(false);
    }
  }

  const themes = [{ value: "light", label: "Claro", description: "Superficies luminosas y contraste limpio.", icon: Sun }, { value: "dark", label: "Oscuro", description: "Entorno sobrio para trabajar con poca luz.", icon: Moon }, { value: "system", label: "Sistema", description: "Sigue la preferencia de este dispositivo.", icon: Laptop }];

  return <div className="page page-narrow"><div className="page-header"><div><p className="eyebrow">Preferencias</p><h1 className="page-title">Configuración</h1><p className="page-subtitle">Ajustes de interfaz y de integración para esta instalación.</p></div></div>

    <section>
      <h2 style={{ margin: "0 0 12px", fontSize: 16 }}>Apariencia</h2>
      <div className="settings-grid">{themes.map((item) => { const Icon = item.icon; return <button key={item.value} className="panel setting-card" data-active={mounted && theme === item.value} onClick={() => setTheme(item.value)}><Icon /><h3>{item.label}</h3><p>{item.description}</p></button>; })}</div>
    </section>

    <section className="panel" style={{ marginTop: 24, padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 18 }}>
        <div>
          <p className="eyebrow" style={{ marginBottom: 6 }}>Integración</p>
          <h2 style={{ margin: 0, fontSize: 18 }}>Holded</h2>
        </div>
        {settings ? <span className={"badge " + (settings.isConfigured ? "badge-success" : "badge-neutral")}>{settings.isConfigured ? "Configurado" : "Sin clave"}</span> : null}
      </div>

      {loading ? <p style={{ margin: 0, color: "var(--foreground-muted)" }}>Cargando configuración…</p> : <>
        <div style={{ display: "grid", gap: 12 }}>
          <div className="notice" style={{ margin: 0 }}>
            {settings?.health.status === "healthy" ? <CheckCircle2 /> : settings?.health.status === "unhealthy" ? <TriangleAlert /> : <ShieldCheck />}
            <span>
              {settings?.health.message ?? "La comprobación de salud no está disponible todavía."}
            </span>
          </div>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 13, color: "var(--foreground-muted)" }}>Clave API de Holded</span>
            <input
              type="password"
              value={apiKeyInput}
              placeholder={settings?.keyMasked ?? "Introduce la clave API"}
              onChange={(event) => setApiKeyInput(event.target.value)}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)" }}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 13, color: "var(--foreground-muted)" }}>Intervalo de salud</span>
            <select
              value={String(checkIntervalMinutes)}
              onChange={(event) => setCheckIntervalMinutes(Number(event.target.value))}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)" }}
            >
              {HOLD_INTERVAL_OPTIONS.map((minutes) => <option key={minutes} value={minutes}>{minutes} minuto{minutes === 1 ? "" : "s"}</option>)}
            </select>
          </label>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--foreground-muted)", fontSize: 13 }}>
              <Clock3 size={15} />
              {settings?.keyMasked ? `Clave guardada: ${settings.keyMasked}` : "Todavía no hay clave guardada."}
            </div>

            <button className="button button-primary" disabled={saving} onClick={handleSave}>
              {saving ? "Guardando…" : "Guardar configuración"}
            </button>
          </div>

          {message ? <p style={{ margin: 0, color: "var(--success)" }}>{message}</p> : null}
          {error ? <p style={{ margin: 0, color: "var(--danger)" }}>{error}</p> : null}
        </div>
      </>}
    </section>

    <div className="panel" style={{ marginTop: 24, padding: 20 }}>
      <h2 style={{ margin: "0 0 7px", fontSize: 15 }}>Index Clima Presupuestos</h2>
      <p style={{ margin: 0, color: "var(--foreground-muted)" }}>El motor económico y la persistencia viven en el backend. La interfaz nunca sustituye sus cálculos.</p>
    </div>
  </div>;
}
