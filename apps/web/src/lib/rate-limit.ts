import { NextResponse } from "next/server";

type BucketEntry = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, BucketEntry>();

export type RateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

function nowMs(): number {
  return Date.now();
}

export function getClientIP(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const [first] = forwarded.split(",");
    if (first?.trim()) {
      return first.trim();
    }
  }

  const realIP = request.headers.get("x-real-ip");
  if (realIP?.trim()) {
    return realIP.trim();
  }

  return "unknown";
}

export function checkRateLimit(
  scope: string,
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const bucketKey = `${scope}:${key}`;
  const current = buckets.get(bucketKey);
  const timestamp = nowMs();

  if (!current || current.resetAt <= timestamp) {
    buckets.set(bucketKey, {
      count: 1,
      resetAt: timestamp + windowMs,
    });
    return {
      ok: true,
      limit,
      remaining: Math.max(0, limit - 1),
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    };
  }

  current.count += 1;

  const remaining = Math.max(0, limit - current.count);
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((current.resetAt - timestamp) / 1000)
  );

  return {
    ok: current.count <= limit,
    limit,
    remaining,
    retryAfterSeconds,
  };
}

export function rateLimitExceededResponse(result: RateLimitResult): NextResponse {
  return NextResponse.json(
    { error: "Too many requests" },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSeconds),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
      },
    }
  );
}
