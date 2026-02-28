import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import pool from "@/lib/db";
import { checkFeatureAccess } from "@/lib/feature-policies";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    return unauthorized();
  }

  const featureAccess = await checkFeatureAccess(session.user.tenantId, "webchat");
  if (featureAccess) {
    return featureAccess;
  }

  const conversations = await pool.query<{
    id: string;
    preview: string;
    created_at: Date;
    last_activity_at: Date;
  }>(
    `SELECT
      c.id,
      c.created_at,
      COALESCE(
        (
          SELECT split_part(m.content, E'\\n', 1)
          FROM messages m
          WHERE m.conversation_id = c.id
          ORDER BY m.created_at ASC
          LIMIT 1
        ),
        'New chat'
      ) AS preview,
      COALESCE(
        (
          SELECT MAX(m2.created_at)
          FROM messages m2
          WHERE m2.conversation_id = c.id
        ),
        c.created_at
      ) AS last_activity_at
    FROM conversations c
    WHERE c.tenant_id = $1
    ORDER BY last_activity_at DESC
    LIMIT 50`,
    [session.user.tenantId]
  );

  return NextResponse.json({
    conversations: conversations.rows.map((row) => ({
      id: row.id,
      preview: row.preview,
      createdAt: row.created_at,
      lastActivityAt: row.last_activity_at,
    })),
  });
}
