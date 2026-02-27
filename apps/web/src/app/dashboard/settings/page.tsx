import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import pool from "@/lib/db";

type SearchParams = {
  connected?: string;
  error?: string;
  disconnected?: string;
};

type WhatsAppChannelRow = {
  channel_user_id: string | null;
  linked_at: string | Date | null;
  muted: boolean;
  webhook_verified: string | null;
  last_webhook_at: string | null;
  last_status: string | null;
  has_access_token: boolean;
};

function formatDate(value: string | Date | null): string {
  if (!value) {
    return "Unknown";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  return date.toLocaleString();
}

function getAPIBaseURL(): string {
  return (
    process.env.API_BASE_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    "http://localhost:8080"
  ).replace(/\/+$/, "");
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const session = await getServerSession(authOptions);
  const tenantId = session?.user?.tenantId;
  if (!tenantId) {
    redirect("/login");
  }

  async function connectWhatsApp(formData: FormData) {
    "use server";

    const activeSession = await getServerSession(authOptions);
    const activeTenantId = activeSession?.user?.tenantId;
    if (!activeTenantId) {
      redirect("/login");
    }

    const phoneNumberId = `${formData.get("phoneNumberId") ?? ""}`.trim();
    const accessToken = `${formData.get("accessToken") ?? ""}`.trim();
    const verifyToken = `${formData.get("verifyToken") ?? ""}`.trim();

    if (!phoneNumberId || !accessToken || !verifyToken) {
      redirect("/dashboard/settings?error=missing_fields");
    }

    const response = await fetch(`${getAPIBaseURL()}/api/channels/whatsapp/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: activeTenantId,
        phone_number_id: phoneNumberId,
        access_token: accessToken,
        verify_token: verifyToken,
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      let errorCode = `status_${response.status}`;
      try {
        const body = (await response.json()) as { error?: string };
        if (body.error) {
          errorCode = body.error.toLowerCase().replace(/\s+/g, "_");
        }
      } catch {
        // ignore response parse failures and use fallback code
      }
      redirect(`/dashboard/settings?error=${encodeURIComponent(errorCode)}`);
    }

    revalidatePath("/dashboard/settings");
    redirect("/dashboard/settings?connected=whatsapp");
  }

  async function disconnectWhatsApp() {
    "use server";

    const activeSession = await getServerSession(authOptions);
    const activeTenantId = activeSession?.user?.tenantId;
    if (!activeTenantId) {
      redirect("/login");
    }

    const response = await fetch(
      `${getAPIBaseURL()}/api/tenants/${activeTenantId}/channels/whatsapp`,
      {
        method: "DELETE",
        cache: "no-store",
      }
    );

    if (!response.ok && response.status !== 404) {
      redirect(`/dashboard/settings?error=${encodeURIComponent(`status_${response.status}`)}`);
    }

    revalidatePath("/dashboard/settings");
    redirect("/dashboard/settings?disconnected=whatsapp");
  }

  const channelResult = await pool.query<WhatsAppChannelRow>(
    `SELECT
       channel_user_id,
       linked_at,
       muted,
       config->>'webhook_verified' AS webhook_verified,
       config->>'last_webhook_at' AS last_webhook_at,
       config->>'last_status' AS last_status,
       NULLIF(config->>'access_token', '') IS NOT NULL AS has_access_token
     FROM tenant_channels
     WHERE tenant_id = $1
       AND channel = 'whatsapp'
     LIMIT 1`,
    [tenantId]
  );

  const channel = channelResult.rows[0] ?? null;
  const isConnected = !!channel;
  const webhookVerified = channel?.webhook_verified === "true";
  const muted = channel?.muted ?? false;

  return (
    <div className="h-full overflow-y-auto bg-[#0a0a0f] px-4 py-6 sm:px-6">
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-100">Settings</h1>
          <p className="mt-1 text-sm text-gray-400">
            Manage channel integrations and deployment providers for your tenant.
          </p>
        </div>

        {searchParams?.connected === "whatsapp" ? (
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            WhatsApp connected successfully.
          </div>
        ) : null}

        {searchParams?.disconnected === "whatsapp" ? (
          <div className="rounded-lg border border-[#3a3a52] bg-[#151522] px-4 py-3 text-sm text-gray-200">
            WhatsApp disconnected.
          </div>
        ) : null}

        {searchParams?.error ? (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            Failed to update WhatsApp settings: {searchParams.error}
          </div>
        ) : null}

        <section className="rounded-xl border border-[#1f1f30] bg-[#11111a] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-xl">
              <h2 className="text-lg font-medium text-gray-100">WhatsApp Business API</h2>
              <p className="mt-1 text-sm text-gray-400">
                Webhook URL: <code>/api/channels/whatsapp/webhook</code>
              </p>
              <p className="mt-1 text-sm text-gray-400">
                Status: {isConnected ? "Connected" : "Not connected"}
                {muted ? " (muted)" : ""}
              </p>
              {isConnected ? (
                <>
                  <p className="mt-1 text-sm text-gray-300">
                    Phone Number ID: {channel?.channel_user_id || "Unknown"}
                  </p>
                  <p className="mt-1 text-sm text-gray-300">
                    Access Token: {channel?.has_access_token ? "Configured" : "Missing"}
                  </p>
                  <p className="mt-1 text-sm text-gray-300">
                    Webhook Verification: {webhookVerified ? "Verified" : "Pending"}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    Connected at: {formatDate(channel?.linked_at ?? null)}
                  </p>
                  {channel?.last_webhook_at ? (
                    <p className="mt-1 text-xs text-gray-500">
                      Last webhook: {formatDate(channel.last_webhook_at)}
                    </p>
                  ) : null}
                  {channel?.last_status ? (
                    <p className="mt-1 text-xs text-gray-500">
                      Last delivery status: {channel.last_status}
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>

            <div className="w-full max-w-sm rounded-lg border border-[#26263a] bg-[#0f0f18] p-4">
              <form action={connectWhatsApp} className="space-y-3">
                <div>
                  <label htmlFor="phoneNumberId" className="block text-xs font-medium uppercase tracking-wide text-gray-400">
                    Phone Number ID
                  </label>
                  <input
                    id="phoneNumberId"
                    name="phoneNumberId"
                    required
                    defaultValue={channel?.channel_user_id ?? ""}
                    className="mt-1 w-full rounded-md border border-[#2b2b42] bg-[#131322] px-3 py-2 text-sm text-gray-100 outline-none ring-0 placeholder:text-gray-500 focus:border-[#6c5ce7]"
                    placeholder="1234567890"
                  />
                </div>
                <div>
                  <label htmlFor="accessToken" className="block text-xs font-medium uppercase tracking-wide text-gray-400">
                    Access Token
                  </label>
                  <input
                    id="accessToken"
                    name="accessToken"
                    type="password"
                    required
                    className="mt-1 w-full rounded-md border border-[#2b2b42] bg-[#131322] px-3 py-2 text-sm text-gray-100 outline-none ring-0 placeholder:text-gray-500 focus:border-[#6c5ce7]"
                    placeholder="EAAG..."
                  />
                </div>
                <div>
                  <label htmlFor="verifyToken" className="block text-xs font-medium uppercase tracking-wide text-gray-400">
                    Verify Token
                  </label>
                  <input
                    id="verifyToken"
                    name="verifyToken"
                    required
                    className="mt-1 w-full rounded-md border border-[#2b2b42] bg-[#131322] px-3 py-2 text-sm text-gray-100 outline-none ring-0 placeholder:text-gray-500 focus:border-[#6c5ce7]"
                    placeholder="your-verify-token"
                  />
                </div>
                <button
                  type="submit"
                  className="inline-flex w-full items-center justify-center rounded-md bg-[#6c5ce7] px-3 py-2 text-sm font-medium text-white hover:opacity-90"
                >
                  {isConnected ? "Update WhatsApp Connection" : "Connect WhatsApp"}
                </button>
              </form>

              {isConnected ? (
                <form action={disconnectWhatsApp} className="mt-3">
                  <button
                    type="submit"
                    className="inline-flex w-full items-center justify-center rounded-md border border-[#3a3a52] px-3 py-2 text-sm font-medium text-gray-200 hover:bg-[#1a1a28]"
                  >
                    Disconnect WhatsApp
                  </button>
                </form>
              ) : null}
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-[#1f1f30] bg-[#11111a] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
          <h2 className="text-lg font-medium text-gray-100">Deploy Integrations</h2>
          <p className="mt-1 text-sm text-gray-400">
            Manage Vercel and Supabase deployment connections on a dedicated page.
          </p>
          <Link
            href="/dashboard/settings/deploy"
            className="mt-4 inline-flex items-center rounded-md bg-[#6c5ce7] px-3 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Open Deploy Settings
          </Link>
        </section>
      </div>
    </div>
  );
}
