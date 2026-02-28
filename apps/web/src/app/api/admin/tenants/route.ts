import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/admin";
import { proxyAdminService } from "@/lib/admin-service";

export const dynamic = "force-dynamic";

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminApiSession();
  if ("response" in auth) {
    return auth.response;
  }

  const proxied = await proxyAdminService<{ tenants?: unknown[] }>("/api/admin/tenants");
  if (!proxied.ok) {
    return proxied.response;
  }

  const tenants = Array.isArray(proxied.data.tenants) ? proxied.data.tenants : [];
  const q = request.nextUrl.searchParams.get("q")?.trim().toLowerCase();

  if (!q) {
    return NextResponse.json({ tenants });
  }

  const filtered = tenants.filter((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }

    const row = item as Record<string, unknown>;
    const email = normalizeText(row.email);
    const id = normalizeText(row.id);
    const status = normalizeText(row.status);
    const container = row.container;
    const containerState =
      container && typeof container === "object"
        ? normalizeText((container as Record<string, unknown>).state)
        : "";

    return email.includes(q) || id.includes(q) || status.includes(q) || containerState.includes(q);
  });

  return NextResponse.json({ tenants: filtered });
}
