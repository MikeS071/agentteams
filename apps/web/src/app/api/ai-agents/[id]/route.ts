import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { buildServiceHeaders } from "@/lib/security";
import { verifyMutationOrigin } from "@/lib/security";
import { parseJSONBody } from "@/lib/validation";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function getAPIURL(id: string) {
  const apiBaseURL = process.env.API_URL ?? "http://localhost:8080";
  return `${apiBaseURL}/api/ai-agents/${id}`;
}

export async function GET(_: Request, context: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    return unauthorized();
  }

  const id = context.params.id;

  try {
    const response = await fetch(getAPIURL(id), {
      method: "GET",
      cache: "no-store",
      headers: {
        "X-Tenant-ID": session.user.tenantId,
        ...buildServiceHeaders(),
      },
    });

    const body = await response.text();
    return new NextResponse(body, {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
    });
  } catch (error) {
    console.error("AI agent detail GET error", error);
    return NextResponse.json({ error: "Failed to load AI agent" }, { status: 500 });
  }
}

export async function PUT(req: Request, context: { params: { id: string } }) {
  const originError = verifyMutationOrigin(req);
  if (originError) {
    return originError;
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    return unauthorized();
  }

  const id = context.params.id;

  const parsed = await parseJSONBody(
    req,
    z.object({
      system_prompt: z.string().max(12000).optional(),
      model: z.string().max(256).optional(),
      enabled_tools: z.array(z.string().max(128)).max(100).optional(),
      enabled: z.boolean().optional(),
    })
  );

  if (!parsed.success) {
    return parsed.response;
  }

  try {
    const response = await fetch(getAPIURL(id), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Tenant-ID": session.user.tenantId,
        ...buildServiceHeaders(),
      },
      body: JSON.stringify(parsed.data),
    });

    const body = await response.text();
    return new NextResponse(body, {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
    });
  } catch (error) {
    console.error("AI agent detail PUT error", error);
    return NextResponse.json({ error: "Failed to update AI agent" }, { status: 500 });
  }
}
