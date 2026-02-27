import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import pool from "@/lib/db";

type CompletionPayload = {
  choices?: Array<{
    message?: {
      role?: string;
      content?: string;
    };
  }>;
};

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    return unauthorized();
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

  const tenantId = session.user.tenantId;
  const client = await pool.connect();
  let conversationId = body.conversationId?.trim();

  try {
    await client.query("BEGIN");

    if (conversationId) {
      const conversation = await client.query(
        "SELECT id FROM conversations WHERE id = $1 AND tenant_id = $2",
        [conversationId, tenantId]
      );
      if (conversation.rows.length === 0) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
      }
    } else {
      const created = await client.query(
        "INSERT INTO conversations (tenant_id) VALUES ($1) RETURNING id",
        [tenantId]
      );
      conversationId = created.rows[0].id;
    }

    await client.query(
      "INSERT INTO messages (conversation_id, role, content, channel) VALUES ($1, 'user', $2, 'web')",
      [conversationId, message]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("chat POST transaction error", error);
    return NextResponse.json({ error: "Failed to save message" }, { status: 500 });
  } finally {
    client.release();
  }

  try {
    const contextResult = await pool.query<{ role: "user" | "assistant" | "system"; content: string; created_at: Date }>(
      `SELECT role, content, created_at
       FROM (
         SELECT role, content, created_at
         FROM messages
         WHERE conversation_id = $1
         ORDER BY created_at DESC
         LIMIT 50
       ) recent
       ORDER BY created_at ASC`,
      [conversationId]
    );

    const llmRes = await fetch("http://localhost:8080/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tenant-ID": tenantId,
      },
      body: JSON.stringify({
        model: process.env.LLM_MODEL ?? "gpt-4o-mini",
        messages: contextResult.rows.map((row) => ({
          role: row.role,
          content: row.content,
        })),
      }),
    });

    if (!llmRes.ok) {
      const errText = await llmRes.text();
      return NextResponse.json(
        { error: "LLM proxy error", details: errText || `status ${llmRes.status}` },
        { status: 502 }
      );
    }

    const payload = (await llmRes.json()) as CompletionPayload;
    const assistantContent = payload.choices?.[0]?.message?.content?.trim();

    if (!assistantContent) {
      return NextResponse.json({ error: "LLM proxy returned empty response" }, { status: 502 });
    }

    await pool.query(
      "INSERT INTO messages (conversation_id, role, content, channel) VALUES ($1, 'assistant', $2, 'web')",
      [conversationId, assistantContent]
    );

    return NextResponse.json({
      conversationId,
      message: {
        role: "assistant",
        content: assistantContent,
      },
    });
  } catch (error) {
    console.error("chat POST llm error", error);
    return NextResponse.json({ error: "Failed to generate assistant response" }, { status: 500 });
  }
}
