import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { checkFeatureAccess } from "@/lib/feature-policies";
import { buildServiceHeaders, verifyMutationOrigin } from "@/lib/security";
import { parseJSONBody } from "@/lib/validation";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function apiBaseURL() {
  return (process.env.API_URL ?? "http://localhost:8080").replace(/\/$/, "");
}

export async function POST(req: Request) {
  const originError = verifyMutationOrigin(req);
  if (originError) {
    return originError;
  }

  const session = await getServerSession(authOptions);
  const tenantId = session?.user?.tenantId?.trim();
  if (!tenantId) {
    return unauthorized();
  }

  const featureError = await checkFeatureAccess(tenantId, "telegram");
  if (featureError) {
    return featureError;
  }

  const parsed = await parseJSONBody(
    req,
    z.object({
      botToken: z.string().trim().min(1),
    })
  );
  if (!parsed.success) {
    return parsed.response;
  }

  const res = await fetch(`${apiBaseURL()}/api/channels/telegram`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildServiceHeaders(),
    },
    body: JSON.stringify({
      tenant_id: tenantId,
      bot_token: parsed.data.botToken,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    return NextResponse.json(
      { error: "Telegram connection failed", details: text || `status ${res.status}` },
      { status: 502 }
    );
  }

  try {
    return NextResponse.json(JSON.parse(text) as unknown);
  } catch {
    return NextResponse.json({ status: "connected" });
  }
}
