import { NextRequest, NextResponse } from "next/server";
import { accessConfig, createSessionToken, credentialsMatch, safeNextPath, SESSION_COOKIE, sessionCookieOptions } from "../../../../lib/session";

const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60_000;
const failures = new Map<string, { count: number; resetAt: number }>();

function clientIp(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
}

/** Inicia sesión con las credenciales de acceso de la instalación y emite la cookie de 30 días. */
export async function POST(request: NextRequest) {
  const config = accessConfig();
  const secure = request.headers.get("x-forwarded-proto") === "https" || request.nextUrl.protocol === "https:";
  const body = await request.json().catch(() => ({})) as { username?: unknown; password?: unknown; next?: unknown };
  const next = safeNextPath(typeof body.next === "string" ? body.next : null);
  if (!config) return NextResponse.json({ ok: true, next });

  const ip = clientIp(request);
  const entry = failures.get(ip);
  if (entry && entry.resetAt > Date.now() && entry.count >= MAX_FAILURES) {
    return NextResponse.json({ error: "too_many_attempts" }, { status: 429, headers: { "Retry-After": String(Math.ceil((entry.resetAt - Date.now()) / 1000)) } });
  }
  const username = typeof body.username === "string" ? body.username : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!credentialsMatch(config, username, password)) {
    const current = entry && entry.resetAt > Date.now() ? entry : { count: 0, resetAt: Date.now() + WINDOW_MS };
    current.count += 1;
    failures.set(ip, current);
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }
  failures.delete(ip);
  const response = NextResponse.json({ ok: true, next });
  response.cookies.set(SESSION_COOKIE, await createSessionToken(config), sessionCookieOptions(secure));
  response.headers.set("Cache-Control", "no-store");
  return response;
}
