"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type AgentStatus = "idle" | "running" | "error";

type AgentSummary = {
  id: string;
  name: string;
  tenant_id: string;
  run_id: string;
  status: AgentStatus;
  current_task: string;
  uptime_seconds: number;
  cpu_percent: number;
  memory_mb: number;
};

type QueueTask = {
  id: string;
  agent_id: string;
  tenant_id: string;
  run_id: string;
  brief: string;
  status: string;
  started_at?: string;
};

type AgentsResponse = {
  agents: AgentSummary[];
  task_queue: {
    pending: QueueTask[];
    running: QueueTask[];
    completed: QueueTask[];
  };
};

type ResourcePoint = {
  timestamp: string;
  cpu_percent: number;
  memory_mb: number;
};

type AgentDetail = {
  agent: AgentSummary;
  logs: string[];
  task_history: QueueTask[];
  resource_chart: ResourcePoint[];
};

function formatUptime(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) {
    return `${hrs}h ${mins}m ${secs}s`;
  }
  if (mins > 0) {
    return `${mins}m ${secs}s`;
  }
  return `${secs}s`;
}

function statusStyles(status: AgentStatus) {
  if (status === "running") {
    return {
      dot: "bg-emerald-400",
      text: "text-emerald-300",
      chip: "bg-emerald-500/10 border-emerald-500/40",
    };
  }
  if (status === "error") {
    return {
      dot: "bg-rose-400",
      text: "text-rose-300",
      chip: "bg-rose-500/10 border-rose-500/40",
    };
  }
  return {
    dot: "bg-amber-400",
    text: "text-amber-300",
    chip: "bg-amber-500/10 border-amber-500/40",
  };
}

export default function AgentsPage() {
  const [data, setData] = useState<AgentsResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<"restart" | "stop" | null>(null);

  const selectedAgent = useMemo(() => data?.agents.find((agent) => agent.id === selectedId), [data?.agents, selectedId]);

  const loadAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/agents", { cache: "no-store" });
      if (!res.ok) {
        throw new Error("Failed to load agent data");
      }

      const payload = (await res.json()) as AgentsResponse;
      setData(payload);

      setSelectedId((current) => {
        if (current && payload.agents.some((agent) => agent.id === current)) {
          return current;
        }
        return payload.agents[0]?.id ?? null;
      });
      setError(null);
    } catch {
      setError("Could not load agent data.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (agentId: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/agents/${agentId}`, { cache: "no-store" });
      if (!res.ok) {
        throw new Error("Failed to load agent detail");
      }
      const payload = (await res.json()) as AgentDetail;
      setDetail(payload);
      setError(null);
    } catch {
      setDetail(null);
      setError("Could not load agent detail.");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAgents();
    const interval = setInterval(() => {
      void loadAgents();
    }, 5000);
    return () => clearInterval(interval);
  }, [loadAgents]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedId);
    const interval = setInterval(() => {
      void loadDetail(selectedId);
    }, 5000);
    return () => clearInterval(interval);
  }, [loadDetail, selectedId]);

  const handleRestart = useCallback(async () => {
    if (!selectedId) {
      return;
    }

    setActionLoading("restart");
    try {
      const res = await fetch(`/api/agents/${selectedId}/restart`, { method: "POST" });
      if (!res.ok) {
        throw new Error("restart failed");
      }
      await Promise.all([loadAgents(), loadDetail(selectedId)]);
    } catch {
      setError("Failed to restart agent.");
    } finally {
      setActionLoading(null);
    }
  }, [loadAgents, loadDetail, selectedId]);

  const handleStop = useCallback(async () => {
    if (!selectedId) {
      return;
    }

    setActionLoading("stop");
    try {
      const res = await fetch(`/api/agents/${selectedId}`, { method: "DELETE" });
      if (!res.ok) {
        throw new Error("stop failed");
      }
      setDetail(null);
      await loadAgents();
    } catch {
      setError("Failed to stop agent.");
    } finally {
      setActionLoading(null);
    }
  }, [loadAgents, selectedId]);

  return (
    <div className="h-full overflow-y-auto bg-[#090a11] p-4 sm:p-6">
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4 lg:gap-5">
        <div className="rounded-2xl border border-[#23243a] bg-[#0e1020] p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold text-gray-100">Agent Swarm</h1>
              <p className="text-sm text-gray-400">Live cluster state with task queue and execution telemetry.</p>
            </div>
            <button
              type="button"
              onClick={() => void loadAgents()}
              className="rounded-md border border-[#2d3150] bg-[#141831] px-3 py-2 text-sm text-gray-200 hover:bg-[#171d3c]"
            >
              Refresh
            </button>
          </div>

          {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_1.6fr]">
          <section className="rounded-2xl border border-[#23243a] bg-[#0e1020] p-3 sm:p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-300">Active Agents</h2>
              <span className="text-xs text-gray-500">{data?.agents.length ?? 0} total</span>
            </div>

            <div className="space-y-2">
              {loading ? <p className="text-sm text-gray-400">Loading agents...</p> : null}

              {!loading && (data?.agents.length ?? 0) === 0 ? (
                <p className="rounded-lg border border-dashed border-[#2c2f48] p-3 text-sm text-gray-500">No agents running.</p>
              ) : null}

              {data?.agents.map((agent) => {
                const styles = statusStyles(agent.status);
                const selected = selectedId === agent.id;
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => setSelectedId(agent.id)}
                    className={`w-full rounded-xl border p-3 text-left transition ${
                      selected
                        ? "border-[#4c5aa0] bg-[#171c35]"
                        : "border-[#2a2f4a] bg-[#12152a] hover:border-[#36406a] hover:bg-[#151a32]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-100">{agent.name}</p>
                        <p className="line-clamp-2 text-xs text-gray-400">{agent.current_task}</p>
                      </div>
                      <div className={`flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] uppercase ${styles.chip} ${styles.text}`}>
                        <span className={`h-2 w-2 rounded-full ${styles.dot}`} />
                        {agent.status}
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-gray-400">
                      <p>Uptime: {formatUptime(agent.uptime_seconds)}</p>
                      <p>CPU: {agent.cpu_percent.toFixed(1)}%</p>
                      <p>Memory: {agent.memory_mb.toFixed(0)} MB</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-[#23243a] bg-[#0e1020] p-3 sm:p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-300">Agent Detail</h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void handleRestart()}
                  disabled={!selectedAgent || actionLoading !== null}
                  className="rounded-md border border-[#2d3150] bg-[#1c2445] px-3 py-1.5 text-xs text-gray-100 disabled:opacity-50"
                >
                  {actionLoading === "restart" ? "Restarting..." : "Restart"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleStop()}
                  disabled={!selectedAgent || actionLoading !== null}
                  className="rounded-md border border-rose-800/50 bg-rose-900/20 px-3 py-1.5 text-xs text-rose-200 disabled:opacity-50"
                >
                  {actionLoading === "stop" ? "Stopping..." : "Stop"}
                </button>
              </div>
            </div>

            {!selectedAgent ? <p className="text-sm text-gray-400">Select an agent to inspect details.</p> : null}
            {detailLoading ? <p className="text-sm text-gray-400">Loading detail...</p> : null}

            {detail ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className="rounded-lg border border-[#2a2f4a] bg-[#12152a] p-3 text-sm">
                    <p className="text-xs uppercase tracking-wide text-gray-500">Status</p>
                    <p className="mt-1 text-gray-100">{detail.agent.status}</p>
                  </div>
                  <div className="rounded-lg border border-[#2a2f4a] bg-[#12152a] p-3 text-sm">
                    <p className="text-xs uppercase tracking-wide text-gray-500">Uptime</p>
                    <p className="mt-1 text-gray-100">{formatUptime(detail.agent.uptime_seconds)}</p>
                  </div>
                  <div className="rounded-lg border border-[#2a2f4a] bg-[#12152a] p-3 text-sm">
                    <p className="text-xs uppercase tracking-wide text-gray-500">Run</p>
                    <p className="mt-1 truncate text-gray-100">{detail.agent.run_id || "n/a"}</p>
                  </div>
                </div>

                <div className="h-56 rounded-xl border border-[#2a2f4a] bg-[#12152a] p-3">
                  <p className="mb-2 text-xs uppercase tracking-wide text-gray-400">Resource Usage</p>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={detail.resource_chart}>
                      <XAxis
                        dataKey="timestamp"
                        tick={{ fill: "#9ca3af", fontSize: 11 }}
                        tickFormatter={(value: string) => new Date(value).toLocaleTimeString([], { minute: "2-digit", second: "2-digit" })}
                      />
                      <YAxis yAxisId="cpu" tick={{ fill: "#9ca3af", fontSize: 11 }} />
                      <YAxis yAxisId="mem" orientation="right" tick={{ fill: "#9ca3af", fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{ background: "#0f1327", border: "1px solid #2a2f4a" }}
                        labelFormatter={(value) => new Date(value).toLocaleTimeString()}
                      />
                      <Line yAxisId="cpu" type="monotone" dataKey="cpu_percent" stroke="#22d3ee" dot={false} strokeWidth={2} name="CPU %" />
                      <Line yAxisId="mem" type="monotone" dataKey="memory_mb" stroke="#f59e0b" dot={false} strokeWidth={2} name="Memory MB" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <div className="rounded-xl border border-[#2a2f4a] bg-[#12152a] p-3">
                    <p className="mb-2 text-xs uppercase tracking-wide text-gray-400">Logs Stream</p>
                    <div className="max-h-64 overflow-auto rounded-md bg-[#0b0e1e] p-2 font-mono text-xs text-gray-300">
                      {detail.logs.map((line, idx) => (
                        <p key={`${line.slice(0, 20)}-${idx}`} className="leading-5">
                          {line}
                        </p>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-[#2a2f4a] bg-[#12152a] p-3">
                    <p className="mb-2 text-xs uppercase tracking-wide text-gray-400">Task History</p>
                    <div className="max-h-64 overflow-auto space-y-2">
                      {detail.task_history.map((task) => (
                        <div key={task.id} className="rounded-md border border-[#2d3452] bg-[#10142a] p-2">
                          <p className="text-xs text-gray-300">{task.brief}</p>
                          <p className="mt-1 text-[11px] uppercase tracking-wide text-gray-500">{task.status}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        </div>

        <section className="rounded-2xl border border-[#23243a] bg-[#0e1020] p-3 sm:p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-300">Task Queue</h2>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {[
              { title: "Pending", key: "pending" as const },
              { title: "Running", key: "running" as const },
              { title: "Completed", key: "completed" as const },
            ].map((column) => (
              <div key={column.key} className="rounded-xl border border-[#2a2f4a] bg-[#12152a] p-3">
                <p className="mb-2 text-xs uppercase tracking-wide text-gray-400">{column.title}</p>
                <div className="max-h-72 overflow-auto space-y-2">
                  {(data?.task_queue[column.key] ?? []).length === 0 ? (
                    <p className="text-xs text-gray-500">No tasks</p>
                  ) : (
                    (data?.task_queue[column.key] ?? []).map((task) => (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => setSelectedId(task.agent_id)}
                        className="w-full rounded-md border border-[#2d3452] bg-[#10142a] p-2 text-left hover:border-[#3f4b7a]"
                      >
                        <p className="line-clamp-2 text-xs text-gray-200">{task.brief}</p>
                        <p className="mt-1 text-[11px] text-gray-500">Agent {task.agent_id.slice(0, 10)}</p>
                      </button>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
