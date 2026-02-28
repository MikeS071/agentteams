"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { InfraPayload, InfraStatus } from "@/lib/admin-mock";

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function statusClasses(status: InfraStatus): string {
  if (status === "running") return "border-emerald-400/40 bg-emerald-500/15 text-emerald-200";
  if (status === "stopped") return "border-gray-500/40 bg-gray-500/15 text-gray-200";
  return "border-red-500/40 bg-red-500/15 text-red-200";
}

export default function AdminInfraPage() {
  const [data, setData] = useState<InfraPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/infra", { cache: "no-store" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Failed to load infrastructure data");
      }

      const payload = (await response.json()) as InfraPayload;
      setData(payload);
      setError(null);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Unknown error";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
    const timer = setInterval(() => {
      void loadData();
    }, 30_000);

    return () => clearInterval(timer);
  }, [loadData]);

  const performAction = useCallback(
    async (containerId: string, action: "restart" | "stop") => {
      setActionError(null);
      setActingOn(`${containerId}-${action}`);
      try {
        const response = await fetch("/api/admin/infra", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ containerId, action }),
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(payload?.error ?? `Failed to ${action} container`);
        }

        const payload = (await response.json()) as { snapshot?: InfraPayload };
        if (payload.snapshot) {
          setData(payload.snapshot);
        } else {
          await loadData();
        }
      } catch (requestError) {
        const message = requestError instanceof Error ? requestError.message : "Unknown error";
        setActionError(message);
      } finally {
        setActingOn(null);
      }
    },
    [loadData]
  );

  const sortedContainers = useMemo(() => {
    if (!data) return [];

    return [...data.containers].sort((a, b) => {
      const statusPriority = { error: 0, running: 1, stopped: 2 } as const;
      const byStatus = statusPriority[a.status] - statusPriority[b.status];
      if (byStatus !== 0) return byStatus;
      return b.cpuPct - a.cpuPct;
    });
  }, [data]);

  if (loading) {
    return <div className="p-6 text-sm text-gray-400">Loading infrastructure monitor...</div>;
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
          {error ?? "No infrastructure data available."}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] p-4 text-gray-100 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-xl border border-[#2a2a38] bg-[#11111a] p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold">Infrastructure Monitoring</h1>
              <p className="mt-1 text-sm text-gray-400">
                Auto-refresh every 30s. Last update {dateTimeFormatter.format(new Date(data.generatedAt))}
              </p>
            </div>
            <span className="rounded-full border border-[#343448] bg-[#181826] px-3 py-1 text-xs uppercase tracking-wide text-gray-300">
              Mock metrics
            </span>
          </div>
          {actionError && (
            <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{actionError}</div>
          )}
        </header>

        <section className="rounded-xl border border-[#2a2a38] bg-[#11111a] p-4 sm:p-6">
          <h2 className="mb-4 text-lg font-semibold">Container Status</h2>
          <div className="overflow-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="px-2 py-2 font-medium">Tenant</th>
                  <th className="px-2 py-2 font-medium">Container</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 font-medium">CPU %</th>
                  <th className="px-2 py-2 font-medium">RAM MB</th>
                  <th className="px-2 py-2 font-medium">Disk MB</th>
                  <th className="px-2 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedContainers.map((container) => {
                  const stopBusy = actingOn === `${container.id}-stop`;
                  const restartBusy = actingOn === `${container.id}-restart`;

                  return (
                    <tr key={container.id} className="border-t border-[#2a2a38]">
                      <td className="px-2 py-3">{container.tenantName}</td>
                      <td className="px-2 py-3 font-mono text-xs text-gray-300">{container.id}</td>
                      <td className="px-2 py-3">
                        <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-medium ${statusClasses(container.status)}`}>
                          {container.status}
                        </span>
                      </td>
                      <td className="px-2 py-3">{container.cpuPct.toFixed(1)}</td>
                      <td className="px-2 py-3">{container.ramMb.toFixed(0)}</td>
                      <td className="px-2 py-3">{container.diskMb.toFixed(0)}</td>
                      <td className="px-2 py-3">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => performAction(container.id, "restart")}
                            disabled={Boolean(actingOn)}
                            className="rounded-md bg-[#00cec9] px-2 py-1 text-xs font-medium text-black transition hover:bg-[#28e0db] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {restartBusy ? "Restarting..." : "Restart"}
                          </button>
                          <button
                            type="button"
                            onClick={() => performAction(container.id, "stop")}
                            disabled={Boolean(actingOn) || container.status === "stopped"}
                            className="rounded-md bg-[#ff7675] px-2 py-1 text-xs font-medium text-black transition hover:bg-[#ff8f8e] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {stopBusy ? "Stopping..." : "Stop"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-[#2a2a38] bg-[#11111a] p-4 sm:p-6">
            <h2 className="mb-4 text-lg font-semibold">Active Alerts</h2>
            {data.alerts.length === 0 ? (
              <p className="text-sm text-gray-400">No active alerts.</p>
            ) : (
              <div className="space-y-3">
                {data.alerts.slice(0, 12).map((alert) => (
                  <div
                    key={alert.id}
                    className={`rounded-lg border p-3 text-sm ${
                      alert.level === "critical"
                        ? "border-red-500/40 bg-red-500/10 text-red-100"
                        : "border-amber-500/40 bg-amber-500/10 text-amber-100"
                    }`}
                  >
                    <p className="font-medium">
                      {alert.tenantName} · {alert.type.toUpperCase()}
                    </p>
                    <p>{alert.message}</p>
                    <p className="mt-1 text-xs opacity-80">{dateTimeFormatter.format(new Date(alert.at))}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-[#2a2a38] bg-[#11111a] p-4 sm:p-6">
            <h2 className="mb-4 text-lg font-semibold">Provisioning Log</h2>
            {data.provisioningLog.length === 0 ? (
              <p className="text-sm text-gray-400">No provisioning events yet.</p>
            ) : (
              <div className="space-y-2">
                {data.provisioningLog.slice(0, 12).map((entry) => (
                  <div key={entry.id} className="rounded-lg border border-[#2a2a38] bg-[#151522] p-3 text-sm">
                    <p className="font-medium capitalize">{entry.action}</p>
                    <p className="text-gray-300">{entry.tenantName}</p>
                    <p className="font-mono text-xs text-gray-400">{entry.containerId}</p>
                    <p className="mt-1 text-xs text-gray-500">{dateTimeFormatter.format(new Date(entry.at))}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
