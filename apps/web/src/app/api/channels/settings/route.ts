import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import pool from "@/lib/db";

const SUPPORTED_CHANNELS = ["telegram", "whatsapp", "web"] as const;
type SupportedChannel = (typeof SUPPORTED_CHANNELS)[number];

type LinkedChannel = {
  channel: SupportedChannel;
  channel_user_id?: string;
  linked_at: string;
  muted: boolean;
};

type LastMessageRow = {
  channel: SupportedChannel;
  last_message_at: string | Date;
};

type PolicyRow = {
  feature: string;
  enabled: boolean;
};

export const dynamic = "force-dynamic";

function isSupportedChannel(value: string): value is SupportedChannel {
  return SUPPORTED_CHANNELS.includes(value as SupportedChannel);
}

function getApiBaseURL(): string {
  return process.env.API_URL ?? "http://localhost:8080";
}

function webchatSnippet(tenantId: string): string {
  return `<div id="agentteams-chat-${tenantId}"></div>\n<script src="https://cdn.agentteams.dev/webchat.js" data-tenant-id="${tenantId}" async></script>`;
}

async function getTenantId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  return session?.user?.tenantId ?? null;
}

async function fetchLinkedChannels(tenantId: string): Promise<LinkedChannel[]> {
  const response = await fetch(`${getApiBaseURL()}/api/tenants/${tenantId}/channels`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch linked channels (${response.status})`);
  }

  const json = (await response.json()) as { channels?: LinkedChannel[] };
  return Array.isArray(json.channels) ? json.channels : [];
}

function policyFeature(channel: SupportedChannel, setting: "notifications" | "auto_reply"): string {
  return `channel:${channel}:${setting}`;
}

export async function GET() {
  try {
    const tenantId = await getTenantId();
    if (!tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [linkedChannels, lastMessageResult, policyResult] = await Promise.all([
      fetchLinkedChannels(tenantId),
      pool.query<LastMessageRow>(
        `SELECT m.channel, MAX(m.created_at) AS last_message_at
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE c.tenant_id = $1
         GROUP BY m.channel`,
        [tenantId]
      ),
      pool.query<PolicyRow>(
        `SELECT feature, enabled
         FROM tenant_policies
         WHERE tenant_id = $1
           AND (
             feature LIKE 'channel:%:notifications'
             OR feature LIKE 'channel:%:auto_reply'
           )`,
        [tenantId]
      ),
    ]);

    const linkedByChannel = new Map(linkedChannels.map((row) => [row.channel, row]));
    const lastMessageByChannel = new Map(
      lastMessageResult.rows.map((row) => {
        const iso = row.last_message_at instanceof Date
          ? row.last_message_at.toISOString()
          : new Date(row.last_message_at).toISOString();
        return [row.channel, iso] as const;
      })
    );

    const policyByFeature = new Map(policyResult.rows.map((row) => [row.feature, row.enabled]));

    const channels = SUPPORTED_CHANNELS.map((channel) => {
      const linked = linkedByChannel.get(channel);
      const notificationsEnabled =
        policyByFeature.get(policyFeature(channel, "notifications")) ?? !(linked?.muted ?? false);
      const autoReplyEnabled = policyByFeature.get(policyFeature(channel, "auto_reply")) ?? true;

      return {
        channel,
        status: linked ? "connected" : "disconnected",
        channelUserId: linked?.channel_user_id ?? null,
        linkedAt: linked?.linked_at ?? null,
        lastMessageAt: lastMessageByChannel.get(channel) ?? null,
        notificationsEnabled,
        autoReplyEnabled,
        connectionDetails:
          linked?.channel_user_id ??
          (channel === "web" ? "Uses AgentTeams hosted webchat widget." : "Not connected"),
        webchatSnippet: channel === "web" ? webchatSnippet(tenantId) : null,
      };
    });

    return NextResponse.json({ channels });
  } catch (error) {
    console.error("Channel settings GET error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    if (!tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      channel?: string;
      notificationsEnabled?: boolean;
      autoReplyEnabled?: boolean;
    };

    const channelValue = body.channel ?? "";
    if (!isSupportedChannel(channelValue)) {
      return NextResponse.json({ error: "Invalid channel" }, { status: 400 });
    }

    const updates: Array<Promise<unknown>> = [];

    if (typeof body.notificationsEnabled === "boolean") {
      updates.push(
        pool.query(
          `INSERT INTO tenant_policies (tenant_id, feature, enabled)
           VALUES ($1, $2, $3)
           ON CONFLICT (tenant_id, feature)
           DO UPDATE SET enabled = EXCLUDED.enabled`,
          [tenantId, policyFeature(channelValue, "notifications"), body.notificationsEnabled]
        )
      );
      updates.push(
        pool.query(
          `UPDATE tenant_channels
           SET muted = $3
           WHERE tenant_id = $1 AND channel = $2`,
          [tenantId, channelValue, !body.notificationsEnabled]
        )
      );
    }

    if (typeof body.autoReplyEnabled === "boolean") {
      updates.push(
        pool.query(
          `INSERT INTO tenant_policies (tenant_id, feature, enabled)
           VALUES ($1, $2, $3)
           ON CONFLICT (tenant_id, feature)
           DO UPDATE SET enabled = EXCLUDED.enabled`,
          [tenantId, policyFeature(channelValue, "auto_reply"), body.autoReplyEnabled]
        )
      );
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: "No updates provided" }, { status: 400 });
    }

    await Promise.all(updates);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Channel settings PATCH error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
