import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/api/health" || request.nextUrl.pathname === "/api/holded-webhook") return NextResponse.next();
  const password = process.env.APP_ACCESS_PASSWORD;
  if (!password) return NextResponse.next();
  const username = process.env.APP_ACCESS_USERNAME || "index-clima";
  const header = request.headers.get("authorization") || "";
  const encoded = header.startsWith("Basic ") ? header.slice(6) : "";
  let presented = "";
  try { presented = Buffer.from(encoded, "base64").toString("utf8"); } catch { /* invalid credential */ }
  const expectedDigest = createHash("sha256").update(`${username}:${password}`).digest();
  const presentedDigest = createHash("sha256").update(presented).digest();
  if (timingSafeEqual(expectedDigest, presentedDigest)) return NextResponse.next();
  return new NextResponse("Acceso restringido", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Index Clima", charset="UTF-8"', "Cache-Control": "no-store" } });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
