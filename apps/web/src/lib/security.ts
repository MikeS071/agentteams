import { NextResponse } from "next/server";

function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function verifyMutationOrigin(request: Request): NextResponse | null {
  const origin = normalizeOrigin(request.headers.get("origin"));
  if (!origin) {
    return NextResponse.json({ error: "Missing Origin header" }, { status: 403 });
  }

  const requestOrigin = normalizeOrigin(request.url);
  const configuredOrigin = normalizeOrigin(process.env.NEXTAUTH_URL);

  const allowedOrigins = new Set<string>();
  if (requestOrigin) {
    allowedOrigins.add(requestOrigin);
  }
  if (configuredOrigin) {
    allowedOrigins.add(configuredOrigin);
  }

  if (!allowedOrigins.has(origin)) {
    return NextResponse.json({ error: "Invalid Origin" }, { status: 403 });
  }

  return null;
}

export function requireServiceAPIKey(): string {
  const key = process.env.SERVICE_API_KEY?.trim();
  if (!key) {
    throw new Error("SERVICE_API_KEY is not configured");
  }
  return key;
}

export function buildServiceHeaders(): Record<string, string> {
  return {
    "X-Service-API-Key": requireServiceAPIKey(),
  };
}
