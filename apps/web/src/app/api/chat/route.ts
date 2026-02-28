import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { checkFeatureAccess } from "@/lib/feature-policies";

type InboundResponse = {
  content?: string;
  conversation_id?: string;
  conversationId?: string;
};

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(req: Request) {
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

  let body: { conversationId?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message = body.message?.trim();
  if (!message) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  const metadata: Record<string, string> = {};
  const conversationId = body.conversationId?.trim();
  if (conversationId) {
    metadata.conversation_id = conversationId;
  }

  const apiBaseURL = process.env.API_URL ?? "http://localhost:8080";

  try {
    const inboundRes = await fetch(`${apiBaseURL}/api/channels/inbound`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tenant_id: session.user.tenantId,
        content: message,
        channel: "web",
        metadata,
      }),
    });

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
