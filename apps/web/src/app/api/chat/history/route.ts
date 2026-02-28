import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import pool from "@/lib/db";
import { checkFeatureAccess } from "@/lib/feature-policies";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    return unauthorized();
  }

  const featureAccess = await checkFeatureAccess(session.user.tenantId, "webchat");
  if (featureAccess) {
    return featureAccess;
  }

  const { searchParams } = new URL(req.url);
  const conversationId = searchParams.get("conversationId")?.trim();

  if (!conversationId) {
    return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
  }

  const ownership = await pool.query(
    "SELECT id FROM conversations WHERE id = $1 AND tenant_id = $2",
    [conversationId, session.user.tenantId]
  );

  if (ownership.rows.length === 0) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const messages = await pool.query<{
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    created_at: Date;
  }>(
    `SELECT id, role, content, created_at
     FROM (
       SELECT id, role, content, created_at
       FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at DESC
       LIMIT 50
     ) recent
     ORDER BY created_at ASC`,
    [conversationId]
  );

  return NextResponse.json({
    messages: messages.rows.map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
    })),
  });
}
