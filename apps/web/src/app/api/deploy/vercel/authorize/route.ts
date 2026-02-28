import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { checkFeatureAccess } from "@/lib/feature-policies";

export const dynamic = "force-dynamic";

function getBaseUrl(request: NextRequest): string {
  return process.env.NEXTAUTH_URL?.replace(/\/$/, "") ?? request.nextUrl.origin;
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const tenantId = session?.user?.tenantId;

  if (!tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const featureAccess = await checkFeatureAccess(tenantId, "deploy");
  if (featureAccess) {
    return featureAccess;
  }

  const clientId = process.env.VERCEL_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "VERCEL_CLIENT_ID is not configured" }, { status: 500 });
  }

  const redirectUri = `${getBaseUrl(request)}/api/deploy/vercel/callback`;
  const state = encrypt(
    JSON.stringify({
      tenantId,
      provider: "vercel",
      issuedAt: Date.now(),
    })
  );

  const authorizeUrl = new URL("https://vercel.com/integrations/new");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);

  return NextResponse.redirect(authorizeUrl);
}
