export const maxDuration = 120;

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { buildServiceHeaders, verifyMutationOrigin } from "@/lib/security";
import { checkFeatureAccess } from "@/lib/feature-policies";
import { parseJSONBody } from "@/lib/validation";

type InboundResponse = {
  content?: string;
  conversation_id?: string;
  conversationId?: string;
};

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(req: Request) {
  const originError = verifyMutationOrigin(req);
  if (originError) {
    return originError;
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    return unauthorized();
  }

  const webchatAccess = await checkFeatureAccess(session.user.tenantId, "webchat");
  if (webchatAccess) {
    return webchatAccess;
  }
  const swarmAccess = await checkFeatureAccess(session.user.tenantId, "swarm");
  if (swarmAccess) {
    return swarmAccess;
  }

  const parsed = await parseJSONBody(
    req,
    z.object({
      conversationId: z.string().uuid().optional(),
      message: z.string().trim().min(1).max(4000),
      model: z.string().optional(),
      agentId: z.string().optional(),
      systemPrompt: z.string().max(8000).optional(),
      enabledTools: z.array(z.string()).max(20).optional(),
    })
  );
  if (!parsed.success) {
    return parsed.response;
  }
  const body = parsed.data;

  const message = body.message;

  const metadata: Record<string, string> = {};
  const conversationId = body.conversationId?.trim();
  if (conversationId) {
    metadata.conversation_id = conversationId;
  }
  if (body.model) {
    metadata.model = body.model;
  }
  if (body.agentId) {
    metadata.agent_id = body.agentId;
  }
  if (body.systemPrompt) {
    metadata.system_prompt = body.systemPrompt;
  }
  if (body.enabledTools && body.enabledTools.length > 0) {
    metadata.enabled_tools = body.enabledTools.join(",");
  }

  const apiBaseURL = process.env.API_URL ?? "http://localhost:8080";

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    const inboundRes = await fetch(`${apiBaseURL}/api/channels/inbound`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...buildServiceHeaders(),
      },
      body: JSON.stringify({
        tenant_id: session.user.tenantId,
        content: message,
        channel: "web",
        metadata,
      }),
    });

    clearTimeout(timeout);
    if (!inboundRes.ok) {
      const errText = await inboundRes.text();
      return NextResponse.json(
        { error: "Channel router error", details: errText || `status ${inboundRes.status}` },
        { status: 502 }
      );
    }

    const payload = (await inboundRes.json()) as InboundResponse;
    const assistantContent = payload.content?.trim();
    const resolvedConversationID =
      payload.conversation_id?.trim() ?? payload.conversationId?.trim() ?? conversationId;

    if (!assistantContent || !resolvedConversationID) {
      return NextResponse.json({ error: "Channel router returned incomplete response" }, { status: 502 });
    }

    return NextResponse.json({
      conversationId: resolvedConversationID,
      message: {
        role: "assistant",
        content: assistantContent,
      },
    });
  } catch (error) {
    console.error("chat POST inbound error", error);
    return NextResponse.json({ error: "Failed to generate assistant response" }, { status: 500 });
  }
}
