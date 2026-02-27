import { Buffer } from "buffer";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { decrypt, encrypt } from "@/lib/crypto";
import pool from "@/lib/db";

type SupabaseTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type SupabaseOrg = {
  id?: string;
  name?: string;
  slug?: string;
};

type OAuthState = {
  tenantId?: string;
  provider?: string;
  issuedAt?: number;
};

export const dynamic = "force-dynamic";

function getBaseUrl(request: NextRequest): string {
  return process.env.NEXTAUTH_URL?.replace(/\/$/, "") ?? request.nextUrl.origin;
}

function settingsUrl(request: NextRequest, params?: Record<string, string>): URL {
  const url = new URL("/dashboard/settings/deploy", getBaseUrl(request));
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return url;
}

function parseState(state: string): OAuthState | null {
  try {
    return JSON.parse(decrypt(state)) as OAuthState;
  } catch {
    return null;
  }
}

function extractOrganizations(payload: unknown): SupabaseOrg[] {
  if (Array.isArray(payload)) {
    return payload as SupabaseOrg[];
  }

  if (payload && typeof payload === "object" && "organizations" in payload) {
    const organizations = (payload as { organizations?: unknown }).organizations;
    if (Array.isArray(organizations)) {
      return organizations as SupabaseOrg[];
    }
  }

  return [];
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const tenantId = session?.user?.tenantId;
  if (!tenantId) {
    return NextResponse.redirect(settingsUrl(request, { error: "unauthorized" }));
  }

  const providerError = request.nextUrl.searchParams.get("error");
  if (providerError) {
    return NextResponse.redirect(settingsUrl(request, { error: providerError }));
  }

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  if (!code || !state) {
    return NextResponse.redirect(settingsUrl(request, { error: "missing_oauth_params" }));
  }

  const parsedState = parseState(state);
  if (!parsedState || parsedState.provider !== "supabase" || parsedState.tenantId !== tenantId) {
    return NextResponse.redirect(settingsUrl(request, { error: "invalid_state" }));
  }

  const clientId = process.env.SUPABASE_CLIENT_ID;
  const clientSecret = process.env.SUPABASE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(settingsUrl(request, { error: "missing_supabase_oauth_config" }));
  }

  const redirectUri = `${getBaseUrl(request)}/api/deploy/supabase/callback`;
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");

  const tokenResponse = await fetch("https://api.supabase.com/v1/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${basicAuth}`,
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
    cache: "no-store",
  });

  if (!tokenResponse.ok) {
    console.error("Supabase OAuth token exchange failed", await tokenResponse.text());
    return NextResponse.redirect(settingsUrl(request, { error: "token_exchange_failed" }));
  }

  const tokenData = (await tokenResponse.json()) as SupabaseTokenResponse;
  if (!tokenData.access_token) {
    console.error("Supabase token response missing access_token", tokenData);
    return NextResponse.redirect(settingsUrl(request, { error: "missing_access_token" }));
  }

  let providerUserId: string | null = null;

  try {
    const orgResponse = await fetch("https://api.supabase.com/v1/organizations", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
      cache: "no-store",
    });

    if (orgResponse.ok) {
      const organizations = extractOrganizations(await orgResponse.json());
      const firstOrg = organizations[0];
      providerUserId = firstOrg?.name ?? firstOrg?.slug ?? firstOrg?.id ?? null;
    }
  } catch (error) {
    console.error("Supabase organization lookup failed", error);
  }

  await pool.query(
    `INSERT INTO deploy_connections (
      tenant_id,
      provider,
      access_token_encrypted,
      refresh_token_encrypted,
      provider_user_id,
      connected_at
    )
    VALUES ($1, 'supabase', $2, $3, $4, NOW())
    ON CONFLICT (tenant_id, provider)
    DO UPDATE SET
      access_token_encrypted = EXCLUDED.access_token_encrypted,
      refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
      provider_user_id = EXCLUDED.provider_user_id,
      connected_at = NOW()`,
    [
      tenantId,
      encrypt(tokenData.access_token),
      tokenData.refresh_token ? encrypt(tokenData.refresh_token) : null,
      providerUserId,
    ]
  );

  return NextResponse.redirect(settingsUrl(request, { connected: "supabase" }));
}
