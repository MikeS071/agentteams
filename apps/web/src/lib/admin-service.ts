import { NextResponse } from "next/server";
import { buildServiceHeaders } from "@/lib/security";

const DEFAULT_API_URL = "http://localhost:8080";

type ProxySuccess<T> = {
  ok: true;
  data: T;
};

type ProxyFailure = {
  ok: false;
  response: NextResponse;
};

function getApiBaseURL(): string {
  const configured = process.env.API_URL?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_API_URL;
}

function parsePayload(text: string): unknown {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: text };
  }
}

function getErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }

  const candidate = (payload as { error?: unknown; message?: unknown }).error
    ?? (payload as { error?: unknown; message?: unknown }).message;

  if (typeof candidate === "string" && candidate.trim().length > 0) {
    return candidate;
  }

  return fallback;
}

export async function proxyAdminService<T>(
  path: string,
  init: RequestInit = {}
): Promise<ProxySuccess<T> | ProxyFailure> {
  const headers = new Headers(init.headers);

  try {
    const serviceHeaders = buildServiceHeaders();
    for (const [key, value] of Object.entries(serviceHeaders)) {
      headers.set(key, value);
    }
  } catch (error) {
    console.error("Admin proxy configuration error:", error);
    return {
      ok: false,
      response: NextResponse.json({ error: "SERVICE_API_KEY is not configured" }, { status: 500 }),
    };
  }

  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const requestInit: RequestInit = {
    ...init,
    cache: "no-store",
    headers,
  };

  let upstream: Response;
  try {
    upstream = await fetch(`${getApiBaseURL()}${path}`, requestInit);
  } catch (error) {
    console.error("Admin proxy upstream error:", error);
    return {
      ok: false,
      response: NextResponse.json({ error: "Failed to reach admin API" }, { status: 502 }),
    };
  }

  const payload = parsePayload(await upstream.text());

  if (!upstream.ok) {
    const message = getErrorMessage(payload, "Admin API request failed");
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: message,
          upstream: payload,
        },
        { status: upstream.status }
      ),
    };
  }

  return {
    ok: true,
    data: (payload ?? {}) as T,
  };
}
