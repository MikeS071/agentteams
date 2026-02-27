import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import pool from "@/lib/db";

export const dynamic = "force-dynamic";

function apiBaseURL(): string {
  return process.env.API_URL ?? "http://localhost:8080";
}

async function tenantIdFromSession(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  return session?.user?.tenantId ?? null;
}

export async function GET() {
  try {
    const tenantId = await tenantIdFromSession();
    if (!tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await pool.query<{
      channel_user_id: string | null;
      bot_username: string | null;
      linked_at: string | Date;
    }>(
      `SELECT channel_user_id, bot_username, linked_at
       FROM tenant_channels
       WHERE tenant_id = $1 AND channel = 'telegram'
       LIMIT 1`,
      [tenantId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ connected: false });
    }

    const row = result.rows[0];
    return NextResponse.json({
      connected: true,
      botUsername: row.bot_username,
      channelUserId: row.channel_user_id,
      linkedAt:
        row.linked_at instanceof Date
          ? row.linked_at.toISOString()
          : new Date(row.linked_at).toISOString(),
    });
  } catch (error) {
    console.error("Telegram status GET error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const tenantId = await tenantIdFromSession();
    if (!tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: { botToken?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const botToken = body.botToken?.trim();
    if (!botToken) {
      return NextResponse.json({ error: "Bot token is required" }, { status: 400 });
    }

    const response = await fetch(`${apiBaseURL()}/api/channels/telegram/connect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tenant_id: tenantId,
        bot_token: botToken,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof payload.error === "string" ? payload.error : "Failed to connect Telegram";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, data: payload });
  } catch (error) {
    console.error("Telegram connect POST error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const tenantId = await tenantIdFromSession();
    if (!tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const response = await fetch(`${apiBaseURL()}/api/channels/telegram/disconnect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tenant_id: tenantId,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof payload.error === "string" ? payload.error : "Failed to disconnect Telegram";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Telegram disconnect DELETE error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
