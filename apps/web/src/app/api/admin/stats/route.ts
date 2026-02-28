import { NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/admin";
import { proxyAdminService } from "@/lib/admin-service";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdminApiSession();
  if ("response" in auth) {
    return auth.response;
  }

  const proxied = await proxyAdminService<Record<string, unknown>>("/api/admin/stats");
  if (!proxied.ok) {
    return proxied.response;
  }

  return NextResponse.json(proxied.data);
}
