"use client";

import { useCallback, useEffect, useState } from "react";

type SubTask = {
  id: string;
  status: string;
};

type SwarmRun = {
  run_id: string;
  task: string;
  status: string;
  trigger_type?: string;
  source_channel?: string;
  started_at?: string;
  sub_tasks?: SubTask[];
};

export default function AgentsPage() {
  const [runs, setRuns] = useState<SwarmRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/agents/runs", { cache: "no-store" });
      if (!res.ok) {
        throw new Error("Failed to fetch runs");
      }
      const data = (await res.json()) as { runs?: SwarmRun[] };
      setRuns(data.runs ?? []);
      setError(null);
    } catch {
      setError("Could not load swarm runs.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRuns();
    const timer = window.setInterval(() => {
      void loadRuns();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [loadRuns]);

  return (
    <div className="h-full overflow-y-auto bg-[#0a0a0f] px-4 py-5 sm:px-6">
      <div className="mx-auto w-full max-w-6xl">
        <h1 className="text-xl font-semibold text-gray-100">Agent Swarm Runs</h1>
        <p className="mt-1 text-sm text-gray-400">Track channel-triggered and manual swarm tasks.</p>

        <div className="mt-4 overflow-hidden rounded-xl border border-[#222235]">
          <table className="min-w-full divide-y divide-[#222235] text-sm">
            <thead className="bg-[#10101a] text-gray-400">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Run</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Channel</th>
                <th className="px-3 py-2 text-left font-medium">Trigger</th>
                <th className="px-3 py-2 text-left font-medium">Subtasks</th>
                <th className="px-3 py-2 text-left font-medium">Task</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1b1b2b] bg-[#0d0d16] text-gray-200">
              {loading ? (
                <tr>
                  <td className="px-3 py-4 text-gray-400" colSpan={6}>
                    Loading runs...
                  </td>
                </tr>
              ) : runs.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-gray-500" colSpan={6}>
                    No swarm runs yet.
                  </td>
                </tr>
              ) : (
                runs.map((run) => (
                  <tr key={run.run_id}>
                    <td className="px-3 py-2 font-mono text-xs text-gray-300">{run.run_id}</td>
                    <td className="px-3 py-2">{run.status}</td>
                    <td className="px-3 py-2">{run.source_channel || "manual"}</td>
                    <td className="px-3 py-2">{run.trigger_type || "manual"}</td>
                    <td className="px-3 py-2">{run.sub_tasks?.length ?? 0}</td>
                    <td className="px-3 py-2 text-gray-300">{run.task}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}
      </div>
    </div>
  );
}
