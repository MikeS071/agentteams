"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type SubTask = {
  id: string;
  brief: string;
  status: string;
  assigned_hand?: string;
  started_at?: string;
  output?: string;
};

type SwarmTask = {
  run_id: string;
  tenant_id: string;
  task: string;
  status: string;
  trigger_type?: string;
  source_channel?: string;
  started_at?: string;
  sub_tasks?: SubTask[];
  output?: string;
};

type TaskEvent = {
  event?: string;
  task?: SwarmTask;
};

const terminalStates = new Set(["complete", "failed", "cancelled"]);

function progressPercent(task: SwarmTask): number {
  const subtasks = task.sub_tasks ?? [];
  if (subtasks.length === 0) {
    return task.status === "complete" ? 100 : 0;
  }
  const done = subtasks.filter((subtask) => terminalStates.has(subtask.status)).length;
  return Math.round((done / subtasks.length) * 100);
}

function statusPillClass(status: string): string {
  switch (status) {
    case "running":
      return "bg-blue-500/15 text-blue-300 border-blue-400/30";
    case "complete":
      return "bg-emerald-500/15 text-emerald-300 border-emerald-400/30";
    case "failed":
      return "bg-red-500/15 text-red-300 border-red-400/30";
    case "cancelled":
      return "bg-gray-500/20 text-gray-300 border-gray-400/30";
    default:
      return "bg-amber-500/15 text-amber-300 border-amber-400/30";
  }
}

export default function SwarmDashboardPage() {
  const [tasks, setTasks] = useState<SwarmTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [newTask, setNewTask] = useState("");
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/swarm/tasks", { cache: "no-store" });
      if (!res.ok) {
        throw new Error("Failed to load swarm tasks");
      }
      const payload = (await res.json()) as { tasks?: SwarmTask[] };
      const list = payload.tasks ?? [];
      setTasks(list);
      setError(null);
      setSelectedTaskId((current) => {
        if (current && list.some((task) => task.run_id === current)) {
          return current;
        }
        return list[0]?.run_id ?? null;
      });
    } catch {
      setError("Could not load swarm tasks.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTasks();
    const timer = window.setInterval(() => {
      void loadTasks();
    }, 8000);
    return () => window.clearInterval(timer);
  }, [loadTasks]);

  useEffect(() => {
    if (!selectedTaskId) {
      return;
    }

    const stream = new EventSource(`/api/swarm/tasks/${encodeURIComponent(selectedTaskId)}/events`);
    stream.addEventListener("update", (evt) => {
      const payload = JSON.parse((evt as MessageEvent).data) as TaskEvent;
      if (!payload.task) return;
      setTasks((prev) => {
        const rest = prev.filter((task) => task.run_id !== payload.task!.run_id);
        return [payload.task!, ...rest];
      });
    });
    stream.addEventListener("snapshot", (evt) => {
      const payload = JSON.parse((evt as MessageEvent).data) as TaskEvent;
      if (!payload.task) return;
      setTasks((prev) => {
        const rest = prev.filter((task) => task.run_id !== payload.task!.run_id);
        return [payload.task!, ...rest];
      });
    });
    stream.addEventListener("complete", (evt) => {
      const payload = JSON.parse((evt as MessageEvent).data) as TaskEvent;
      if (!payload.task) return;
      setTasks((prev) => {
        const rest = prev.filter((task) => task.run_id !== payload.task!.run_id);
        return [payload.task!, ...rest];
      });
    });
    stream.onerror = () => {
      stream.close();
    };

    return () => {
      stream.close();
    };
  }, [selectedTaskId]);

  const selectedTask = useMemo(() => tasks.find((task) => task.run_id === selectedTaskId) ?? null, [selectedTaskId, tasks]);

  async function handleCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const taskText = newTask.trim();
    if (!taskText || creating) {
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/swarm/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: taskText }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { details?: string; error?: string };
        throw new Error(data.error || data.details || "Failed to create task");
      }

      setNewTask("");
      await loadTasks();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to create task";
      setError(message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-[#0a0a0f] px-4 py-5 sm:px-6">
      <div className="mx-auto w-full max-w-7xl space-y-5">
        <header className="rounded-2xl border border-[#212135] bg-[#0f0f18] p-4">
          <h1 className="text-xl font-semibold text-gray-100">Agent Swarm</h1>
          <p className="mt-1 text-sm text-gray-400">
            Coordinator-driven tasks with live sub-agent progress and assigned Hands.
          </p>
          <form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={handleCreateTask}>
            <input
              value={newTask}
              onChange={(event) => setNewTask(event.target.value)}
              className="w-full rounded-lg border border-[#2a2a40] bg-[#0b0b13] px-3 py-2 text-sm text-gray-100 outline-none focus:border-[#6c5ce7]"
              placeholder="Describe the complex task to decompose and delegate"
            />
            <button
              type="submit"
              disabled={creating}
              className="rounded-lg bg-[#6c5ce7] px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {creating ? "Submitting..." : "Start Swarm"}
            </button>
          </form>
        </header>

        <section className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <div className="rounded-2xl border border-[#212135] bg-[#0f0f18] p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Active Swarm Tasks</h2>
            <div className="mt-3 space-y-3">
              {loading ? <p className="text-sm text-gray-500">Loading tasks...</p> : null}
              {!loading && tasks.length === 0 ? <p className="text-sm text-gray-500">No swarm tasks yet.</p> : null}
              {tasks.map((task) => {
                const percent = progressPercent(task);
                const selected = selectedTaskId === task.run_id;
                return (
                  <button
                    type="button"
                    key={task.run_id}
                    onClick={() => setSelectedTaskId(task.run_id)}
                    className={`w-full rounded-xl border p-3 text-left transition ${
                      selected
                        ? "border-[#6c5ce7] bg-[#141427]"
                        : "border-[#222238] bg-[#10101b] hover:border-[#323250]"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-mono text-xs text-gray-300">{task.run_id}</p>
                      <span className={`rounded-full border px-2 py-0.5 text-xs ${statusPillClass(task.status)}`}>
                        {task.status}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm text-gray-200">{task.task}</p>
                    <div className="mt-3">
                      <div className="mb-1 flex items-center justify-between text-xs text-gray-400">
                        <span>Progress</span>
                        <span>{percent}%</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-[#1f1f30]">
                        <div className="h-full rounded-full bg-gradient-to-r from-[#6c5ce7] to-[#3dc9a6]" style={{ width: `${percent}%` }} />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-[#212135] bg-[#0f0f18] p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Task Detail</h2>
            {!selectedTask ? (
              <p className="mt-3 text-sm text-gray-500">Select a task to inspect sub-agent work.</p>
            ) : (
              <div className="mt-3 space-y-4">
                <div>
                  <p className="text-xs text-gray-500">Coordinator</p>
                  <p className="font-medium text-gray-100">Task {selectedTask.run_id}</p>
                  <p className="mt-1 text-sm text-gray-300">{selectedTask.task}</p>
                </div>

                <div>
                  <p className="text-xs text-gray-500">Sub-agent Tree</p>
                  <div className="mt-2 space-y-2">
                    {(selectedTask.sub_tasks ?? []).map((subtask) => (
                      <div key={subtask.id} className="rounded-lg border border-[#222238] bg-[#10101b] px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-mono text-xs text-gray-300">{subtask.id}</p>
                          <span className={`rounded-full border px-2 py-0.5 text-xs ${statusPillClass(subtask.status)}`}>
                            {subtask.status}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-gray-200">{subtask.brief}</p>
                        <p className="mt-1 text-xs text-gray-400">
                          Assigned Hand: {subtask.assigned_hand || "Unassigned"}
                        </p>
                        {subtask.output ? (
                          <pre className="mt-2 max-h-32 overflow-auto rounded bg-[#0b0b12] p-2 text-xs text-gray-300">
                            {subtask.output}
                          </pre>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {error ? <p className="text-sm text-red-400">{error}</p> : null}
      </div>
    </div>
  );
}
