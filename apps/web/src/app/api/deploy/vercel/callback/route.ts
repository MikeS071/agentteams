import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { decrypt, encrypt } from "@/lib/crypto";
import pool from "@/lib/db";
import { checkFeatureAccess } from "@/lib/feature-policies";
import { parseWithSchema } from "@/lib/validation";

type VercelTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  user_id?: string;
  team_id?: string;
  error?: string;
  error_description?: string;
};

type VercelUserResponse = {
  user?: {
    id?: string;
    email?: string;
    username?: string;
  };
};

type VercelTeamResponse = {
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

function isValidOAuthState(state: OAuthState, provider: "vercel" | "supabase", tenantId: string): boolean {
  const issuedAt = Number(state.issuedAt);
  if (
    !state ||
    state.provider !== provider ||
    state.tenantId !== tenantId ||
    !Number.isFinite(issuedAt)
  ) {
    return false;
  }
  return Date.now() - issuedAt <= 10 * 60 * 1000;
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const tenantId = session?.user?.tenantId;
  if (!tenantId) {
    return NextResponse.redirect(settingsUrl(request, { error: "unauthorized" }));
  }
  const featureAccess = await checkFeatureAccess(tenantId, "deploy");
  if (featureAccess) {
    return featureAccess;
  }

  const parsedQuery = parseWithSchema(
    {
      error: request.nextUrl.searchParams.get("error"),
      code: request.nextUrl.searchParams.get("code"),
      state: request.nextUrl.searchParams.get("state"),
    },
    z.object({
      error: z.string().min(1).optional().nullable(),
      code: z.string().min(1).optional().nullable(),
      state: z.string().min(1).optional().nullable(),
    }),
    "Invalid query params"
  );
  if (!parsedQuery.success) {
    return NextResponse.redirect(settingsUrl(request, { error: "invalid_query_params" }));
  }

  const providerError = parsedQuery.data.error ?? null;
  if (providerError) {
    return NextResponse.redirect(settingsUrl(request, { error: providerError }));
  }

  const code = parsedQuery.data.code ?? null;
  const state = parsedQuery.data.state ?? null;
  if (!code || !state) {
    return NextResponse.redirect(settingsUrl(request, { error: "missing_oauth_params" }));
  }

  const parsedState = parseState(state);
  if (!parsedState || !isValidOAuthState(parsedState, "vercel", tenantId)) {
    return NextResponse.redirect(settingsUrl(request, { error: "invalid_state" }));
  }

  const clientId = process.env.VERCEL_CLIENT_ID;
  const clientSecret = process.env.VERCEL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(settingsUrl(request, { error: "missing_vercel_oauth_config" }));
  }

  const redirectUri = `${getBaseUrl(request)}/api/deploy/vercel/callback`;

  const tokenResponse = await fetch("https://api.vercel.com/v2/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
    cache: "no-store",
  });

  if (!tokenResponse.ok) {
    console.error("Vercel OAuth token exchange failed", await tokenResponse.text());
    return NextResponse.redirect(settingsUrl(request, { error: "token_exchange_failed" }));
  }

  const tokenData = (await tokenResponse.json()) as VercelTokenResponse;
  if (!tokenData.access_token) {
    console.error("Vercel token response missing access_token", tokenData);
    return NextResponse.redirect(settingsUrl(request, { error: "missing_access_token" }));
  }

  let providerUserId: string | null = tokenData.user_id ?? tokenData.team_id ?? null;

  try {
    const userResponse = await fetch("https://api.vercel.com/v2/user", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
      cache: "no-store",
    });

    if (userResponse.ok) {
      const userData = (await userResponse.json()) as VercelUserResponse;
      providerUserId =
        userData.user?.email ?? userData.user?.username ?? userData.user?.id ?? providerUserId;
    }

    if (tokenData.team_id) {
      const teamResponse = await fetch(
        `https://api.vercel.com/v2/teams/${encodeURIComponent(tokenData.team_id)}`,
        {
          headers: {
            Authorization: `Bearer ${tokenData.access_token}`,
          },
          cache: "no-store",
        }
      );

      if (teamResponse.ok) {
        const teamData = (await teamResponse.json()) as VercelTeamResponse;
        const teamName = teamData.name ?? teamData.slug ?? teamData.id;
        if (teamName) {
          providerUserId = providerUserId ? `${providerUserId} (${teamName})` : teamName;
        }
      }
    }
  } catch (error) {
    console.error("Vercel profile lookup failed", error);
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
    VALUES ($1, 'vercel', $2, $3, $4, NOW())
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

  return NextResponse.redirect(settingsUrl(request, { connected: "vercel" }));
}
