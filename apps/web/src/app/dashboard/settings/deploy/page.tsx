import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import pool from "@/lib/db";
import { getTenantFeatureMap } from "@/lib/feature-policies";

const PROVIDERS = ["vercel", "supabase"] as const;
type DeployProvider = (typeof PROVIDERS)[number];

type ConnectionRow = {
  provider: DeployProvider;
  provider_user_id: string | null;
  connected_at: string | Date;
};

type StatusSearchParams = {
  connected?: string;
  error?: string;
};

type ProviderMeta = {
  label: string;
  authorizePath: string;
  accountLabel: string;
};

const providerMeta: Record<DeployProvider, ProviderMeta> = {
  vercel: {
    label: "Vercel",
    authorizePath: "/api/deploy/vercel/authorize",
    accountLabel: "Connected account",
  },
  supabase: {
    label: "Supabase",
    authorizePath: "/api/deploy/supabase/authorize",
    accountLabel: "Connected organization",
  },
};

function isDeployProvider(value: string | null): value is DeployProvider {
  return !!value && PROVIDERS.includes(value as DeployProvider);
}

function formatConnectedAt(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  return date.toLocaleString();
}

export default async function DeploySettingsPage({
  searchParams,
}: {
  searchParams?: StatusSearchParams;
}) {
  const session = await getServerSession(authOptions);
  const tenantId = session?.user?.tenantId;

  if (!tenantId) {
    redirect("/login");
  }

  const featureMap = await getTenantFeatureMap(tenantId);
  if (!featureMap.deploy) {
    return (
      <div className="h-full overflow-y-auto bg-[#0a0a0f] px-4 py-6 sm:px-6">
        <div className="mx-auto w-full max-w-4xl">
          <div className="rounded-xl border border-[#1f1f30] bg-[#11111a] p-6">
            <h1 className="text-xl font-semibold text-gray-100">Deploy Integrations</h1>
            <p className="mt-2 text-sm text-gray-400">
              Feature not available on your plan.
            </p>
          </div>
        </div>
      </div>
    );
  }

  async function disconnectConnection(formData: FormData) {
    "use server";

    const activeSession = await getServerSession(authOptions);
    const activeTenantId = activeSession?.user?.tenantId;

    if (!activeTenantId) {
      redirect("/login");
    }

    const providerValue = formData.get("provider");
    if (typeof providerValue !== "string" || !isDeployProvider(providerValue)) {
      return;
    }

    await pool.query(
      `DELETE FROM deploy_connections
       WHERE tenant_id = $1 AND provider = $2`,
      [activeTenantId, providerValue]
    );

    revalidatePath("/dashboard/settings/deploy");
  }

  const result = await pool.query<ConnectionRow>(
    `SELECT provider, provider_user_id, connected_at
     FROM deploy_connections
     WHERE tenant_id = $1`,
    [tenantId]
  );

  const connections = new Map<DeployProvider, ConnectionRow>();
  for (const row of result.rows) {
    connections.set(row.provider, row);
  }

  return (
    <div className="h-full overflow-y-auto bg-[#0a0a0f] px-4 py-6 sm:px-6">
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-100">Deploy Integrations</h1>
          <p className="mt-1 text-sm text-gray-400">
            Connect deployment providers to automate provisioning for your tenant.
          </p>
        </div>

        {searchParams?.connected ? (
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            Connected {searchParams.connected} successfully.
          </div>
        ) : null}

        {searchParams?.error ? (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            OAuth connection failed: {searchParams.error}
          </div>
        ) : null}

        {PROVIDERS.map((provider) => {
          const meta = providerMeta[provider];
          const connection = connections.get(provider);
          const isConnected = !!connection;

          return (
            <section
              key={provider}
              className="rounded-xl border border-[#1f1f30] bg-[#11111a] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-medium text-gray-100">{meta.label}</h2>
                  <p className="mt-1 text-sm text-gray-400">
                    Status: {isConnected ? "Connected" : "Not connected"}
                  </p>
                  {connection?.provider_user_id ? (
                    <p className="mt-1 text-sm text-gray-300">
                      {meta.accountLabel}: {connection.provider_user_id}
                    </p>
                  ) : null}
                  {connection?.connected_at ? (
                    <p className="mt-1 text-xs text-gray-500">
                      Connected at: {formatConnectedAt(connection.connected_at)}
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Link
                    href={meta.authorizePath}
                    className="inline-flex items-center rounded-md bg-[#6c5ce7] px-3 py-2 text-sm font-medium text-white hover:opacity-90"
                  >
                    {isConnected ? `Reconnect ${meta.label}` : `Connect ${meta.label}`}
                  </Link>

                  {isConnected ? (
                    <form action={disconnectConnection}>
                      <input type="hidden" name="provider" value={provider} />
                      <button
                        type="submit"
                        className="inline-flex items-center rounded-md border border-[#3a3a52] px-3 py-2 text-sm font-medium text-gray-200 hover:bg-[#1a1a28]"
                      >
                        Disconnect
                      </button>
                    </form>
                  ) : null}
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
