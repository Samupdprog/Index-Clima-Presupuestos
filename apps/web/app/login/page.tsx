"use client";

import { Eye, EyeOff, LoaderCircle, LogIn } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";

function LoginForm() {
  const params = useSearchParams();
  const [username, setUsername] = useState("index-clima");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password, next: params.get("next") }) });
      const payload = await response.json().catch(() => ({})) as { next?: string; error?: string };
      if (!response.ok) {
        setError(payload.error === "too_many_attempts" ? "Demasiados intentos. Espera unos minutos antes de volver a probar." : "Usuario o contraseña incorrectos.");
        return;
      }
      window.location.replace(payload.next ?? "/presupuestos");
    } catch {
      setError("No se pudo conectar. Revisa la conexión e inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={(event) => void submit(event)}>
        <img src="/index-clima-logo.png" alt="Index Clima" className="login-logo" />
        <div>
          <h1>Presupuestos</h1>
          <p>Inicia sesión una vez: este dispositivo se recordará durante 30 días.</p>
        </div>
        <label className="field">
          <span className="field-label">Usuario</span>
          <input className="input" value={username} autoComplete="username" autoCapitalize="none" spellCheck={false} onChange={(event) => setUsername(event.target.value)} required />
        </label>
        <label className="field">
          <span className="field-label">Contraseña</span>
          <span className="login-password">
            <input className="input" type={visible ? "text" : "password"} value={password} autoComplete="current-password" autoFocus onChange={(event) => setPassword(event.target.value)} required />
            <button type="button" className="button button-ghost button-icon" aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"} onClick={() => setVisible((value) => !value)}>{visible ? <EyeOff /> : <Eye />}</button>
          </span>
        </label>
        {error ? <p className="error-text" role="alert">{error}</p> : null}
        <button type="submit" className="button button-primary login-submit" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <LogIn />}{busy ? "Entrando…" : "Entrar"}</button>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
