import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type Provider from "oidc-provider";
import type { OAuthServerConfig } from "./config.js";
import { ownerAccountId } from "./provider.js";
import { isLoopbackRedirect } from "./redirect-policy.js";

const SCOPE_LABELS: Record<string, string> = {
  "clients:read": "Consultar clientes",
  "clients:write": "Crear y modificar clientes (también en Holded)",
  "quotes:read": "Consultar presupuestos y catálogos",
  "quotes:write": "Crear y modificar presupuestos",
  "holded:read": "Consultar el estado y los presupuestos existentes en Holded",
  "holded:write": "Enviar presupuestos y contactos a Holded",
  offline_access: "Mantener la conexión sin volver a iniciar sesión",
};

const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60_000;

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function safeEqual(a: string, b: string) {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

function page(res: ServerResponse, title: string, body: string, status = 200) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
  });
  res.end(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;background:#f4f6f8;color:#1b2430;margin:0}main{max-width:30rem;margin:3rem auto;background:#fff;border-radius:12px;padding:2rem;box-shadow:0 2px 12px #0001}h1{font-size:1.3rem}label{display:block;margin:.8rem 0 .3rem}input[type=text],input[type=password]{width:100%;padding:.6rem;border:1px solid #c5ccd6;border-radius:8px;box-sizing:border-box}button{padding:.7rem 1.2rem;border-radius:8px;border:0;font-weight:600;cursor:pointer;margin-top:1rem}.primary{background:#0b6e4f;color:#fff}.secondary{background:#e3e7ec}.warn{background:#fff4e5;border:1px solid #f0b35b;padding:.6rem;border-radius:8px}.muted{color:#5b6675;font-size:.9rem}li{margin:.3rem 0}code{background:#eef1f4;padding:.1rem .3rem;border-radius:4px}</style></head><body><main>${body}</main></body></html>`);
}

async function readForm(req: IncomingMessage) {
  let data = "";
  for await (const chunk of req) {
    data += String(chunk);
    if (data.length > 10_000) throw new Error("payload_too_large");
  }
  return new URLSearchParams(data);
}

function clientIp(req: IncomingMessage) {
  const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim();
  return forwarded || req.socket.remoteAddress || "unknown";
}

/** Pantallas de login (propietario de la instalación) y consentimiento. */
export function createInteractionHandler(provider: Provider, config: OAuthServerConfig) {
  const failures = new Map<string, { count: number; resetAt: number }>();
  const accountId = ownerAccountId(config);

  function blocked(ip: string) {
    const entry = failures.get(ip);
    if (!entry || entry.resetAt < Date.now()) { failures.delete(ip); return false; }
    return entry.count >= MAX_FAILURES;
  }
  function recordFailure(ip: string) {
    const entry = failures.get(ip);
    if (!entry || entry.resetAt < Date.now()) failures.set(ip, { count: 1, resetAt: Date.now() + WINDOW_MS });
    else entry.count += 1;
  }

  function loginPage(res: ServerResponse, uid: string, error?: string, status = 200) {
    page(res, "Iniciar sesión", `<h1>${escapeHtml(config.installationName)} · Presupuestos</h1>
<p class="muted">Inicia sesión como propietario para autorizar el acceso de la IA a esta instalación.</p>
${error ? `<p class="warn">${escapeHtml(error)}</p>` : ""}
<form method="post" action="/oauth/interaction/${escapeHtml(uid)}/login" autocomplete="off">
<label for="username">Usuario</label><input id="username" name="username" type="text" required autocomplete="username">
<label for="password">Contraseña</label><input id="password" name="password" type="password" required autocomplete="current-password">
<button class="primary" type="submit">Iniciar sesión</button></form>
<form method="post" action="/oauth/interaction/${escapeHtml(uid)}/abort"><button class="secondary" type="submit">Cancelar</button></form>`, status);
  }

  async function consentPage(res: ServerResponse, uid: string, details: Awaited<ReturnType<Provider["interactionDetails"]>>) {
    const clientId = String(details.params.client_id ?? "");
    const client = await provider.Client.find(clientId);
    const clientUrl = URL.parse(clientId);
    const redirectUri = String(details.params.redirect_uri ?? "");
    const redirectHost = URL.parse(redirectUri)?.host ?? redirectUri;
    const missing = (details.prompt.details.missingResourceScopes ?? {}) as Record<string, string[]>;
    const resourceScopes = [...new Set(Object.values(missing).flat())].filter((scope) => config.scopes.includes(scope as never));
    const oidcScopes = ((details.prompt.details.missingOIDCScope ?? []) as string[]).filter((scope) => scope === "offline_access");
    const items = [...resourceScopes, ...oidcScopes].map((scope) => `<li><label><input type="checkbox" name="scope" value="${escapeHtml(scope)}" checked> ${escapeHtml(SCOPE_LABELS[scope] ?? scope)} <code>${escapeHtml(scope)}</code></label></li>`).join("");
    page(res, "Autorizar acceso", `<h1>Autorizar acceso a ${escapeHtml(config.installationName)}</h1>
<p><strong>${escapeHtml(clientUrl ? clientUrl.host : client?.clientName ?? clientId)}</strong>${client?.clientName ? ` <span class="muted">(se presenta como «${escapeHtml(client.clientName)}»)</span>` : ""} solicita acceso al MCP del Generador de Presupuestos.</p>
<p class="muted">Tras autorizar volverás a: <strong>${escapeHtml(redirectHost)}</strong></p>
${isLoopbackRedirect(redirectUri) ? `<p class="warn">La respuesta irá a una aplicación de este ordenador (${escapeHtml(redirectHost)}). Autoriza solo si acabas de iniciar la conexión desde ella (Claude Code, MCP Inspector…).</p>` : ""}
<form method="post" action="/oauth/interaction/${escapeHtml(uid)}/confirm"><p>Permisos solicitados:</p><ul>${items || "<li>Sin permisos adicionales</li>"}</ul>
<p class="muted">Los importes los calcula siempre el Generador. La IA nunca recibe claves de Holded ni credenciales internas.</p>
<button class="primary" type="submit">Autorizar</button></form>
<form method="post" action="/oauth/interaction/${escapeHtml(uid)}/abort"><button class="secondary" type="submit">Denegar</button></form>`);
  }

  return async function handleInteraction(req: IncomingMessage, res: ServerResponse, uid: string, action: string | undefined) {
    try {
      const details = await provider.interactionDetails(req, res);
      if (details.uid !== uid) return page(res, "Sesión no válida", "<h1>La sesión de autorización no es válida</h1><p>Vuelve a la aplicación y reintenta.</p>", 400);
      if (req.method === "GET" && !action) {
        if (details.prompt.name === "login") return loginPage(res, uid);
        if (details.prompt.name === "consent") return consentPage(res, uid, details);
        return page(res, "Autorización", "<h1>Paso de autorización no admitido</h1>", 400);
      }
      if (req.method !== "POST") return page(res, "Método no permitido", "<h1>Método no permitido</h1>", 405);
      if (action === "abort") {
        return provider.interactionFinished(req, res, { error: "access_denied", error_description: "El propietario denegó la autorización" }, { mergeWithLastSubmission: false });
      }
      const form = await readForm(req);
      if (action === "login" && details.prompt.name === "login") {
        const ip = clientIp(req);
        if (blocked(ip)) return loginPage(res, uid, "Demasiados intentos fallidos. Espera 15 minutos.", 429);
        const valid = safeEqual(form.get("username") ?? "", config.ownerUsername) && safeEqual(form.get("password") ?? "", config.ownerPassword);
        if (!valid) { recordFailure(ip); return loginPage(res, uid, "Usuario o contraseña incorrectos.", 401); }
        failures.delete(ip);
        return provider.interactionFinished(req, res, { login: { accountId } }, { mergeWithLastSubmission: false });
      }
      if (action === "confirm" && details.prompt.name === "consent") {
        const selected = new Set(form.getAll("scope"));
        const session = details.session;
        if (!session || session.accountId !== accountId) return page(res, "Sesión no válida", "<h1>Inicia sesión de nuevo</h1>", 400);
        const clientId = String(details.params.client_id);
        const grant = details.grantId ? await provider.Grant.find(details.grantId) : new provider.Grant({ accountId, clientId });
        if (!grant) return page(res, "Autorización caducada", "<h1>La autorización ha caducado</h1>", 400);
        const missingOidc = (details.prompt.details.missingOIDCScope ?? []) as string[];
        // `openid` no concede nada; offline_access solo si el propietario lo mantiene marcado.
        const oidc = missingOidc.filter((scope) => scope === "openid" || selected.has(scope));
        if (oidc.length) grant.addOIDCScope(oidc.join(" "));
        const rejectedOidc = missingOidc.filter((scope) => !oidc.includes(scope));
        if (rejectedOidc.length) grant.rejectOIDCScope(rejectedOidc.join(" "));
        const missingClaims = details.prompt.details.missingOIDCClaims as string[] | undefined;
        if (missingClaims?.length) grant.addOIDCClaims(missingClaims);
        let granted = 0;
        for (const [indicator, scopes] of Object.entries((details.prompt.details.missingResourceScopes ?? {}) as Record<string, string[]>)) {
          const allowed = scopes.filter((scope) => selected.has(scope) && config.scopes.includes(scope as never));
          if (allowed.length) { grant.addResourceScope(indicator, allowed.join(" ")); granted += allowed.length; }
          // Rechazo explícito: el token se emite sin ellos y no se vuelve a preguntar en bucle.
          const rejected = scopes.filter((scope) => !allowed.includes(scope));
          if (rejected.length) grant.rejectResourceScope(indicator, rejected.join(" "));
        }
        if (!granted && Object.keys(details.prompt.details.missingResourceScopes ?? {}).length) {
          return provider.interactionFinished(req, res, { error: "access_denied", error_description: "No se concedió ningún permiso" }, { mergeWithLastSubmission: false });
        }
        const grantId = await grant.save();
        return provider.interactionFinished(req, res, { consent: { grantId } }, { mergeWithLastSubmission: true });
      }
      return page(res, "Autorización", "<h1>Acción no válida</h1>", 400);
    } catch {
      return page(res, "Autorización caducada", "<h1>La autorización ha caducado o no es válida</h1><p>Vuelve a la aplicación y reintenta la conexión.</p>", 400);
    }
  };
}
