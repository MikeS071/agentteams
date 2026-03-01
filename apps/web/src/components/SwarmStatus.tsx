"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type TicketStatus = "done" | "running" | "todo" | "failed" | "blocked";

type SwarmTicket = {
  id: string;
  phase: number;
  status: TicketStatus;
  description: string;
  startedAt?: string;
  elapsedSeconds?: number;
  output?: string;
};

type SwarmStats = {
  done: number;
  running: number;
  todo: number;
  failed: number;
  blocked: number;
  total: number;
  percent: number;
};

type SwarmStatusResponse = {
  project: string;
  phase: number;
  stats: SwarmStats;
  tickets: SwarmTicket[];
};

export type SwarmStatusProps = {
  projectName?: string;
  compact?: boolean;
  onClose?: () => void;
};

const STATUS_ORDER: TicketStatus[] = ["done", "running", "todo", "failed", "blocked"];

function normalizeStatus(status: string): TicketStatus {
  const lowered = status.toLowerCase();
  if (["done", "complete", "completed", "success"].includes(lowered)) {
    return "done";
  }
  if (["running", "in_progress", "active"].includes(lowered)) {
    return "running";
  }
  if (["failed", "error"].includes(lowered)) {
    return "failed";
  }
  if (["blocked", "paused", "waiting"].includes(lowered)) {
    return "blocked";
  }
  return "todo";
}

function statusBadgeClass(status: TicketStatus): string {
  switch (status) {
    case "done":
      return "bg-emerald-500/20 text-emerald-300 border-emerald-400/40";
    case "running":
      return "bg-blue-500/20 text-blue-300 border-blue-400/40";
    case "failed":
      return "bg-red-500/20 text-red-300 border-red-400/40";
    case "blocked":
      return "bg-amber-500/20 text-amber-300 border-amber-400/40";
    default:
      return "bg-slate-500/20 text-slate-300 border-slate-400/40";
  }
}

function formatElapsed(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remain = safe % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${remain}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${remain}s`;
  }
  return `${remain}s`;
}

function buildBlockProgress(percent: number): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const total = 6;
  const filled = Math.max(0, Math.min(total, Math.round((clamped / 100) * total)));
  return `${"█".repeat(filled)}${"░".repeat(total - filled)}`;
}

function computePhaseSteps(tickets: SwarmTicket[], activePhase: number) {
  const maxPhase = Math.max(3, ...tickets.map((ticket) => ticket.phase));
  const steps = Array.from({ length: maxPhase }, (_, index) => index + 1);
  return steps.map((phase) => {
    const inPhase = tickets.filter((ticket) => ticket.phase === phase);
    const allDone = inPhase.length > 0 && inPhase.every((ticket) => ticket.status === "done");
    const anyRunning = inPhase.some((ticket) => ticket.status === "running");

    if (phase < activePhase || allDone) {
      return { phase, icon: "✅" };
    }
    if (phase === activePhase && anyRunning) {
      return { phase, icon: "🔄" };
    }
    if (phase === activePhase) {
      return { phase, icon: "🔄" };
    }
    return { phase, icon: "⬚" };
  });
}

function getPhaseGatePending(tickets: SwarmTicket[]): { pending: boolean; fromPhase?: number; toPhase?: number } {
  const phases = Array.from(new Set(tickets.map((ticket) => ticket.phase))).sort((a, b) => a - b);
  for (let i = 0; i < phases.length - 1; i += 1) {
    const fromPhase = phases[i];
    const toPhase = phases[i + 1];
    const fromTickets = tickets.filter((ticket) => ticket.phase === fromPhase);
    const toTickets = tickets.filter((ticket) => ticket.phase === toPhase);
    if (
      fromTickets.length > 0 &&
      toTickets.length > 0 &&
      fromTickets.every((ticket) => ticket.status === "done") &&
      toTickets.every((ticket) => ticket.status === "todo")
    ) {
      return { pending: true, fromPhase, toPhase };
    }
  }
  return { pending: false };
}

function normalizePayload(raw: unknown): SwarmStatusResponse {
  const fallback: SwarmStatusResponse = {
    project: "agentsquads",
    phase: 1,
    stats: {
      done: 0,
      running: 0,
      todo: 0,
      failed: 0,
      blocked: 0,
      total: 0,
      percent: 0,
    },
    tickets: [],
  };

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fallback;
  }

  const data = raw as Partial<SwarmStatusResponse> & Record<string, unknown>;
  const rawTickets = Array.isArray(data.tickets) ? data.tickets : [];
  const tickets: SwarmTicket[] = [];
  for (const ticket of rawTickets) {
    if (!ticket || typeof ticket !== "object" || Array.isArray(ticket)) {
      continue;
    }

    const value = ticket as Record<string, unknown>;
    const id = typeof value.id === "string" ? value.id : "";
    const description = typeof value.description === "string" ? value.description : "";
    if (!id || !description) {
      continue;
    }

    const phaseNumber = typeof value.phase === "number" ? value.phase : 1;
    const startedAt = typeof value.startedAt === "string" ? value.startedAt : undefined;
    const output = typeof value.output === "string" ? value.output : undefined;
    const elapsedSeconds = typeof value.elapsedSeconds === "number" ? value.elapsedSeconds : undefined;

    tickets.push({
      id,
      phase: Number.isFinite(phaseNumber) ? phaseNumber : 1,
      status: normalizeStatus(typeof value.status === "string" ? value.status : "todo"),
      description,
      startedAt,
      output,
      elapsedSeconds,
    });
  }

  const statsRecord = data.stats && typeof data.stats === "object" && !Array.isArray(data.stats)
    ? (data.stats as Record<string, unknown>)
    : {};

  const done = typeof statsRecord.done === "number" ? statsRecord.done : tickets.filter((ticket) => ticket.status === "done").length;
  const running = typeof statsRecord.running === "number"
    ? statsRecord.running
    : tickets.filter((ticket) => ticket.status === "running").length;
  const todo = typeof statsRecord.todo === "number" ? statsRecord.todo : tickets.filter((ticket) => ticket.status === "todo").length;
  const failed = typeof statsRecord.failed === "number"
    ? statsRecord.failed
    : tickets.filter((ticket) => ticket.status === "failed").length;
  const blocked = typeof statsRecord.blocked === "number"
    ? statsRecord.blocked
    : tickets.filter((ticket) => ticket.status === "blocked").length;
  const total = typeof statsRecord.total === "number" ? statsRecord.total : tickets.length;
  const percent = typeof statsRecord.percent === "number" ? statsRecord.percent : total > 0 ? Math.round((done / total) * 100) : 0;

  return {
    project: typeof data.project === "string" && data.project.trim() ? data.project : fallback.project,
    phase: typeof data.phase === "number" && Number.isFinite(data.phase) && data.phase > 0 ? data.phase : 1,
    stats: { done, running, todo, failed, blocked, total, percent },
    tickets,
  };
}

export default function SwarmStatus({ projectName, compact = false, onClose }: SwarmStatusProps) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<SwarmStatusResponse | null>(null);
  const [now, setNow] = useState(Date.now());
  const [flashingTickets, setFlashingTickets] = useState<Set<string>>(new Set());
  const previousStatusRef = useRef<Record<string, TicketStatus>>({});
  const flashTimersRef = useRef<Record<string, number>>({});

  const fetchStatus = useCallback(async () => {
    try {
      const query = projectName?.trim() ? `?project=${encodeURIComponent(projectName.trim())}` : "";
      const res = await fetch(`/api/swarm/status${query}`, { cache: "no-store" });
      if (!res.ok) {
        throw new Error("Failed to load swarm status");
      }

      const json = (await res.json()) as unknown;
      setPayload(normalizePayload(json));
      setError(null);
    } catch {
      setError("Could not load swarm status.");
    } finally {
      setLoading(false);
    }
  }, [projectName]);

  useEffect(() => {
    void fetchStatus();
    const timer = window.setInterval(() => {
      void fetchStatus();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [fetchStatus]);

  useEffect(() => {
    const runningExists = (payload?.tickets ?? []).some((ticket) => ticket.status === "running");
    if (!runningExists) {
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [payload]);

  useEffect(() => {
    const next = payload?.tickets ?? [];
    if (next.length === 0) {
      return;
    }

    const previous = previousStatusRef.current;
    const completedNow: string[] = [];
    const nextStatusMap: Record<string, TicketStatus> = {};

    for (const ticket of next) {
      nextStatusMap[ticket.id] = ticket.status;
      if (ticket.status === "done" && previous[ticket.id] && previous[ticket.id] !== "done") {
        completedNow.push(ticket.id);
      }
    }

    if (completedNow.length > 0) {
      setFlashingTickets((current) => {
        const copy = new Set(current);
        for (const ticketId of completedNow) {
          copy.add(ticketId);
        }
        return copy;
      });

      for (const ticketId of completedNow) {
        if (flashTimersRef.current[ticketId]) {
          window.clearTimeout(flashTimersRef.current[ticketId]);
        }
        flashTimersRef.current[ticketId] = window.setTimeout(() => {
          setFlashingTickets((current) => {
            const copy = new Set(current);
            copy.delete(ticketId);
            return copy;
          });
        }, 1000);
      }
    }

    previousStatusRef.current = nextStatusMap;
  }, [payload]);

  useEffect(() => {
    const timerMap = flashTimersRef.current;
    return () => {
      const timerIds = Object.values(timerMap);
      for (const timerId of timerIds) {
        window.clearTimeout(timerId);
      }
    };
  }, []);

  const tickets = useMemo(() => payload?.tickets ?? [], [payload]);
  const stats = payload?.stats;
  const activeProject = payload?.project ?? projectName ?? "agentsquads";
  const activePhase = payload?.phase ?? 1;
  const doneCount = stats?.done ?? 0;
  const totalCount = stats?.total ?? 0;
  const runningCount = stats?.running ?? 0;
  const percent = stats?.percent ?? 0;
  const progressBar = buildBlockProgress(percent);

  const phaseSteps = useMemo(() => computePhaseSteps(tickets, activePhase), [activePhase, tickets]);
  const runningTickets = useMemo(() => tickets.filter((ticket) => ticket.status === "running"), [tickets]);
  const recentlyDone = useMemo(() => tickets.filter((ticket) => ticket.status === "done").slice(-3).reverse(), [tickets]);
  const failedTickets = useMemo(() => tickets.filter((ticket) => ticket.status === "failed"), [tickets]);
  const phaseGate = useMemo(() => getPhaseGatePending(tickets), [tickets]);

  const withElapsed = useCallback(
    (ticket: SwarmTicket) => {
      if (typeof ticket.elapsedSeconds === "number") {
        return ticket.elapsedSeconds;
      }
      if (ticket.startedAt) {
        const started = new Date(ticket.startedAt).getTime();
        if (!Number.isNaN(started)) {
          return Math.max(0, Math.floor((now - started) / 1000));
        }
      }
      return 0;
    },
    [now]
  );

  if (compact) {
    return (
      <section className="border-b border-[#1d1d2c] bg-[#0d0d14]">
        <div className="h-10 flex items-center justify-between px-3">
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm text-gray-200"
          >
            <span className="text-xs text-gray-300">{expanded ? "▲" : "▼"}</span>
            <span className="truncate font-medium">Swarm: {activeProject}</span>
            <span className="font-mono text-[11px] text-gray-400">{progressBar}</span>
            <span className="hidden text-xs text-gray-400 sm:inline">
              {doneCount}/{totalCount} done · {runningCount} running
            </span>
          </button>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded px-2 py-1 text-xs text-gray-400 hover:bg-[#1b1b2a] hover:text-gray-200"
              aria-label="Dismiss swarm status"
            >
              ✕
            </button>
          ) : null}
        </div>

        <div className={`overflow-hidden transition-all duration-300 ease-in-out ${expanded ? "max-h-[220px]" : "max-h-0"}`}>
          <div className="space-y-3 px-3 pb-3">
            {loading && !payload ? <p className="text-xs text-gray-500">Loading swarm status...</p> : null}
            {error ? <p className="text-xs text-red-400">{error}</p> : null}

            <div className="rounded-lg border border-[#232335] bg-[#11111b] px-2 py-2">
              <div className="flex flex-wrap items-center gap-1 text-[11px] text-gray-300">
                {phaseSteps.map((step, index) => (
                  <span key={step.phase} className="inline-flex items-center gap-1">
                    <span>{`Phase ${step.phase} ${step.icon}`}</span>
                    {index < phaseSteps.length - 1 ? <span className="text-gray-500">→</span> : null}
                  </span>
                ))}
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-[#242438] bg-[#121220] p-2">
                <p className="text-[11px] uppercase tracking-wide text-gray-500">Running</p>
                <div className="mt-1 space-y-1">
                  {runningTickets.length === 0 ? (
                    <p className="text-xs text-gray-500">No running tickets.</p>
                  ) : (
                    runningTickets.slice(0, 3).map((ticket) => (
                      <div key={ticket.id} className="rounded border border-[#24324a] bg-[#0f1623] px-2 py-1">
                        <p className="truncate text-xs text-blue-200">
                          <span className="font-mono">{ticket.id}</span> · {ticket.description}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-[#242438] bg-[#121220] p-2">
                <p className="text-[11px] uppercase tracking-wide text-gray-500">Recently Completed</p>
                <div className="mt-1 space-y-1">
                  {recentlyDone.length === 0 ? (
                    <p className="text-xs text-gray-500">No completed tickets yet.</p>
                  ) : (
                    recentlyDone.map((ticket) => (
                      <div key={ticket.id} className="rounded border border-[#233d31] bg-[#0f1a15] px-2 py-1">
                        <p className="truncate text-xs text-emerald-200">
                          <span className="font-mono">{ticket.id}</span> · {ticket.description}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {failedTickets.length > 0 ? (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2">
                <p className="text-[11px] uppercase tracking-wide text-red-300">Failed Tickets</p>
                <div className="mt-1 space-y-1">
                  {failedTickets.slice(0, 2).map((ticket) => (
                    <p key={ticket.id} className="truncate text-xs text-red-200">
                      <span className="font-mono">{ticket.id}</span> · {ticket.description}
                    </p>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-[#1d1d2c] bg-[#0d0d14] p-4">
      <div className="space-y-4">
        <header className="space-y-3 border-b border-[#1d1d2c] pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-gray-500">Swarm Workspace</p>
              <h2 className="text-xl font-semibold text-gray-100">{activeProject}</h2>
              <p className="text-sm text-gray-400">Active Phase: Phase {activePhase}</p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
              {STATUS_ORDER.map((status) => (
                <div key={status} className={`rounded-full border px-2 py-1 text-center capitalize ${statusBadgeClass(status)}`}>
                  {status} {(stats?.[status] ?? 0) as number}
                </div>
              ))}
            </div>
          </div>

          <div className="h-2 w-full overflow-hidden rounded-full bg-[#1c1c2b]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#3b82f6] via-[#22c55e] to-[#16a34a] transition-all duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="text-xs text-gray-400">
            {percent}% complete ({doneCount}/{totalCount})
          </p>

          <div className="rounded-lg border border-[#25253a] bg-[#10101a] px-3 py-2">
            <div className="flex flex-wrap items-center gap-1 text-sm text-gray-200">
              {phaseSteps.map((step, index) => (
                <span key={step.phase} className="inline-flex items-center gap-1">
                  <span>{`Phase ${step.phase} ${step.icon}`}</span>
                  {index < phaseSteps.length - 1 ? <span className="text-gray-500">→</span> : null}
                </span>
              ))}
            </div>
          </div>

          {phaseGate.pending ? (
            <div className="flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
              <p className="text-sm text-amber-200">
                Phase gate pending: Phase {phaseGate.fromPhase} is complete. Ready to open Phase {phaseGate.toPhase}.
              </p>
              <button
                type="button"
                className="rounded-md border border-amber-400/40 bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-100 hover:bg-amber-500/25"
              >
                Approve Phase Gate
              </button>
            </div>
          ) : null}
        </header>

        {loading && !payload ? <p className="text-sm text-gray-500">Loading swarm status...</p> : null}
        {error ? <p className="text-sm text-red-400">{error}</p> : null}

        <div className="overflow-x-auto rounded-xl border border-[#1f1f31]">
          <table className="min-w-full divide-y divide-[#202035] text-sm">
            <thead className="bg-[#10101a] text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left">ID</th>
                <th className="px-3 py-2 text-left">Phase</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e1e30] bg-[#0d0d14]">
              {tickets.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-sm text-gray-500">
                    No tickets found for this project.
                  </td>
                </tr>
              ) : (
                tickets.map((ticket) => (
                  <tr
                    key={ticket.id}
                    className={`transition-colors ${flashingTickets.has(ticket.id) ? "bg-emerald-500/15" : "bg-transparent"}`}
                  >
                    <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-gray-300">{ticket.id}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-gray-300">Phase {ticket.phase}</td>
                    <td className="whitespace-nowrap px-3 py-3">
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${statusBadgeClass(ticket.status)}`}>
                        {ticket.status === "running" ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-300" /> : null}
                        {ticket.status}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-gray-200">
                      <p>{ticket.description}</p>
                      {ticket.status === "running" ? (
                        <p className="mt-1 text-xs text-blue-300">Elapsed: {formatElapsed(withElapsed(ticket))}</p>
                      ) : null}
                      {ticket.status === "running" ? (
                        <details className="mt-2 rounded border border-[#2a2a40] bg-[#10101b]">
                          <summary className="cursor-pointer px-2 py-1 text-xs text-gray-300">Agent output</summary>
                          <pre className="max-h-40 overflow-auto border-t border-[#2a2a40] p-2 text-xs text-gray-200">
                            <code>{ticket.output || "No output available yet."}</code>
                          </pre>
                        </details>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
