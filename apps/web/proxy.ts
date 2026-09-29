import { NextRequest, NextResponse } from "next/server";
import { accessConfig, createSessionToken, credentialsMatch, SESSION_COOKIE, SESSION_RENEW_BELOW_SECONDS, sessionCookieOptions, verifySessionToken } from "./lib/session";

/** Rutas accesibles sin sesión: login, salud, webhook firmado e iconos de la app. */
const PUBLIC_PATHS = new Set(["/login", "/api/auth/login", "/api/health", "/api/holded-webhook", "/manifest.webmanifest", "/icon.png", "/apple-icon.png", "/favicon.ico"]);

function isSecure(request: NextRequest) {
  return request.headers.get("x-forwarded-proto") === "https" || request.nextUrl.protocol === "https:";
}

/** Basic auth sigue aceptándose para herramientas (curl, monitorización); el navegador usa la sesión. */
function basicCredentials(request: NextRequest) {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Basic ")) return null;
  try {
    const decoded = atob(header.slice(6));
    const separator = decoded.indexOf(":");
    return separator < 0 ? null : { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  const config = accessConfig();
  const { pathname, search } = request.nextUrl;
  if (!config || PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const expiresAt = await verifySessionToken(config, request.cookies.get(SESSION_COOKIE)?.value);
  if (expiresAt) {
    const response = NextResponse.next();
    // Renovación deslizante: quien usa la app a menudo no vuelve a ver el login.
    if (expiresAt - Math.floor(Date.now() / 1000) < SESSION_RENEW_BELOW_SECONDS) {
      response.cookies.set(SESSION_COOKIE, await createSessionToken(config), sessionCookieOptions(isSecure(request)));
    }
    return response;
  }

  const basic = basicCredentials(request);
  if (basic && credentialsMatch(config, basic.username, basic.password)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "session_required" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
