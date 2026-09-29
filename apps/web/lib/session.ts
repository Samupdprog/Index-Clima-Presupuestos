// Sesión web persistente: cookie firmada con HMAC-SHA256 (Web Crypto, válido en proxy y rutas).
// No guarda la contraseña ni datos personales: solo caducidad, un nonce y la firma.

export const SESSION_COOKIE = "ic_session";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
/** Por debajo de este tiempo restante la sesión se renueva en la siguiente visita. */
export const SESSION_RENEW_BELOW_SECONDS = 15 * 24 * 60 * 60;

const encoder = new TextEncoder();

export interface AccessConfig {
  username: string;
  password: string;
  secretMaterial: string;
}

/** `null` si el acceso web no está protegido (APP_ACCESS_PASSWORD vacío, p. ej. desarrollo local). */
export function accessConfig(env: Record<string, string | undefined> = process.env): AccessConfig | null {
  const password = env.APP_ACCESS_PASSWORD;
  if (!password) return null;
  const username = env.APP_ACCESS_USERNAME || "index-clima";
  // Cambiar la contraseña (o APP_SESSION_SECRET) invalida todas las sesiones abiertas.
  const secretMaterial = env.APP_SESSION_SECRET || `index-clima-session\n${username}\n${password}\n${env.INTERNAL_SERVICE_TOKEN ?? ""}`;
  return { username, password, secretMaterial };
}

function base64url(bytes: ArrayBuffer | Uint8Array) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacKey(secretMaterial: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secretMaterial));
  return crypto.subtle.importKey("raw", digest, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function signature(secretMaterial: string, payload: string) {
  return base64url(await crypto.subtle.sign("HMAC", await hmacKey(secretMaterial), encoder.encode(payload)));
}

/** Comparación en tiempo constante de dos strings. */
export function constantTimeEqual(a: string, b: string) {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let diff = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return diff === 0;
}

export async function createSessionToken(config: AccessConfig, nowSeconds = Math.floor(Date.now() / 1000)) {
  const nonce = base64url(crypto.getRandomValues(new Uint8Array(16)));
  const payload = `v1.${nowSeconds + SESSION_MAX_AGE_SECONDS}.${nonce}`;
  return `${payload}.${await signature(config.secretMaterial, payload)}`;
}

/** Devuelve la caducidad (segundos Unix) si el token es auténtico y vigente; si no, `null`. */
export async function verifySessionToken(config: AccessConfig, token: string | undefined, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1" || !/^\d{9,11}$/.test(parts[1]!)) return null;
  const payload = parts.slice(0, 3).join(".");
  if (!constantTimeEqual(await signature(config.secretMaterial, payload), parts[3]!)) return null;
  const expiresAt = Number(parts[1]);
  return expiresAt > nowSeconds ? expiresAt : null;
}

export function credentialsMatch(config: AccessConfig, username: string, password: string) {
  // Se evalúan ambos para no revelar cuál falló por tiempo de respuesta.
  const userOk = constantTimeEqual(username.trim(), config.username);
  const passwordOk = constantTimeEqual(password, config.password);
  return userOk && passwordOk;
}

/** Solo rutas internas relativas como destino tras el login (evita redirecciones abiertas). */
export function safeNextPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\") || value.startsWith("/login")) return "/presupuestos";
  return value;
}

export function sessionCookieOptions(secure: boolean, maxAge = SESSION_MAX_AGE_SECONDS) {
  return { httpOnly: true, secure, sameSite: "lax" as const, path: "/", maxAge };
}
