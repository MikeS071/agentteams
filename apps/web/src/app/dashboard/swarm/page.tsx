"use client";

import { useState } from "react";
import SwarmStatus from "@/components/SwarmStatus";

const PROJECT_OPTIONS = ["agentsquads"];

export default function SwarmDashboardPage() {
  const [projectName, setProjectName] = useState(PROJECT_OPTIONS[0]);

  return (
    <div className="h-full overflow-y-auto bg-[#0a0a0f] px-4 py-5 sm:px-6">
      <div className="mx-auto w-full max-w-7xl space-y-4">
        <header className="rounded-2xl border border-[#1d1d2c] bg-[#0d0d14] p-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-gray-100">Swarm Workspace</h1>
              <p className="mt-1 text-sm text-gray-400">
                Dedicated swarm tracking with phase progress, running agents, and gate approvals.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <label className="text-xs uppercase tracking-[0.14em] text-gray-500" htmlFor="swarm-project">
                Project
              </label>
              <select
                id="swarm-project"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                className="h-9 rounded-md border border-[#2b2b42] bg-[#10101a] px-3 text-sm text-gray-100 focus:border-[#3b82f6] focus:outline-none"
              >
                {PROJECT_OPTIONS.map((project) => (
                  <option key={project} value={project}>
                    {project}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="h-9 rounded-md border border-amber-400/40 bg-amber-500/15 px-3 text-sm font-medium text-amber-100 hover:bg-amber-500/25"
              >
                Approve Phase Gate
              </button>
            </div>
          </div>
        </header>

        <SwarmStatus projectName={projectName} />
      </div>
    </div>
  );
}
