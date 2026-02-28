import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const SUPPORTED_CHANNELS = ["telegram", "whatsapp", "web"] as const;
type SupportedChannel = (typeof SUPPORTED_CHANNELS)[number];

function isSupportedChannel(value: string): value is SupportedChannel {
  return SUPPORTED_CHANNELS.includes(value as SupportedChannel);
}

function getApiBaseURL(): string {
  return process.env.API_URL ?? "http://localhost:8080";
}

async function getTenantId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  return session?.user?.tenantId ?? null;
}

function normalizePhoneNumber(value: string): string {
  return value.replace(/[^\d+]/g, "");
}

async function linkChannel(tenantId: string, channel: SupportedChannel, channelUserId: string) {
  const response = await fetch(`${getApiBaseURL()}/api/tenants/${tenantId}/channels`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ channel, channel_user_id: channelUserId }),
  });

  if (!response.ok) {
    throw new Error(`Failed to link ${channel} (${response.status})`);
  }
}

async function unlinkChannel(tenantId: string, channel: SupportedChannel) {
  const response = await fetch(`${getApiBaseURL()}/api/tenants/${tenantId}/channels/${channel}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!response.ok && response.status !== 404) {
    throw new Error(`Failed to unlink ${channel} (${response.status})`);
  }
}

export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    if (!tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      channel?: string;
      botToken?: string;
      phoneNumber?: string;
    };

    const channelValue = body.channel ?? "";
    if (!isSupportedChannel(channelValue)) {
      return NextResponse.json({ error: "Invalid channel" }, { status: 400 });
    }

    if (channelValue === "telegram") {
      const token = (body.botToken ?? "").trim();
      if (!token) {
        return NextResponse.json({ error: "Bot token is required" }, { status: 400 });
      }

      const verifyResponse = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!verifyResponse.ok) {
        return NextResponse.json({ error: "Telegram verification failed" }, { status: 400 });
      }

      const verifyJson = (await verifyResponse.json()) as {
        ok?: boolean;
        result?: { id?: number; username?: string };
      };

      if (!verifyJson.ok || !verifyJson.result?.id) {
        return NextResponse.json({ error: "Invalid Telegram bot token" }, { status: 400 });
      }

      const channelUserId = verifyJson.result.username
        ? `@${verifyJson.result.username} (${verifyJson.result.id})`
        : String(verifyJson.result.id);

      await linkChannel(tenantId, channelValue, channelUserId);
      return NextResponse.json({ ok: true, channelUserId });
    }

    if (channelValue === "whatsapp") {
      const normalized = normalizePhoneNumber((body.phoneNumber ?? "").trim());
      if (normalized.length < 8) {
        return NextResponse.json({ error: "Enter a valid phone number" }, { status: 400 });
      }

      await linkChannel(tenantId, channelValue, normalized);
      return NextResponse.json({ ok: true, channelUserId: normalized });
    }

    const webchatId = `webchat-${tenantId.slice(0, 8)}`;
    await linkChannel(tenantId, channelValue, webchatId);
    return NextResponse.json({ ok: true, channelUserId: webchatId });
  } catch (error) {
    console.error("Channel connection POST error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    if (!tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as { channel?: string };
    const channelValue = body.channel ?? "";

    if (!isSupportedChannel(channelValue)) {
      return NextResponse.json({ error: "Invalid channel" }, { status: 400 });
    }

    await unlinkChannel(tenantId, channelValue);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Channel connection DELETE error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
