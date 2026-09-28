import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const origin = request.headers.get("origin");
  if (!["GET", "HEAD"].includes(request.method) && origin) {
    // Next's internal URL uses the container port; Host retains the browser's public authority.
    const expectedOrigin = process.env.PUBLIC_APP_URL ?? `${request.nextUrl.protocol}//${request.headers.get("host")}`;
    if (origin !== expectedOrigin) return Response.json({ error: "cross_origin_forbidden" }, { status: 403 });
  }
  const { path } = await context.params;
  if (path.some((segment) => !/^[a-zA-Z0-9_-]+$/.test(segment))) {
    return Response.json({ error: "invalid_path" }, { status: 400 });
  }
  const baseUrl = process.env.INTERNAL_API_URL ?? "http://127.0.0.1:4000";
  const target = new URL(path.join("/"), `${baseUrl.replace(/\/$/, "")}/`);
  target.search = request.nextUrl.search;

  const headers = new Headers({ accept: "application/json" });
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (token) headers.set("authorization", `Bearer ${token}`);
  headers.set("x-actor-type", "user");
  if (request.headers.get("content-type")) headers.set("content-type", request.headers.get("content-type")!);

  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.text();
  try {
    const response = await fetch(target, {
      method: request.method,
      headers,
      ...(body !== undefined ? { body } : {}),
      cache: "no-store",
    });
    const forwarded: Record<string, string> = {
      "content-type": response.headers.get("content-type") ?? "application/json",
    };
    const holdedSearch = response.headers.get("x-holded-search");
    if (holdedSearch) forwarded["x-holded-search"] = holdedSearch;
    return new Response(response.body, { status: response.status, headers: forwarded });
  } catch {
    return Response.json({ error: "api_unavailable" }, { status: 503 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
