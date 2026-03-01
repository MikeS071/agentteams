"use client";

import type { AgentType } from "@/lib/agents";

type Props = {
  agents: AgentType[];
  selectedAgentId: string;
  onSelect: (agent: AgentType) => void;
  onConfigure?: (agent: AgentType) => void;
  variant?: "hero" | "compact";
};

export default function AgentGrid({ agents, selectedAgentId, onSelect, onConfigure, variant = "compact" }: Props) {
  const isHero = variant === "hero";

  return (
    <div className="rounded-2xl border border-[#24242c] bg-[#0f0f12]/85 backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-[#222228] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          <p className="ml-2 text-xs font-medium uppercase tracking-[0.16em] text-gray-400">AI Agents</p>
        </div>
        <span className="text-xs text-gray-500">{agents.length} agents</span>
      </div>

      <div className={`grid gap-3 p-3 ${isHero ? "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3" : "grid-cols-2"}`}>
        {agents.map((agent) => {
          const isActive = selectedAgentId === agent.id;
          return (
            <div
              key={agent.id}
              className={`group relative rounded-2xl border p-3 text-left transition ${
                isHero ? "min-h-[180px]" : "min-h-[96px]"
              } ${
                isActive
                  ? "border-[#2f8f5b] bg-[#102018] shadow-[0_0_0_1px_rgba(47,143,91,0.3)]"
                  : "border-[#26262f] bg-[#14141a] hover:border-[#3a3a44] hover:bg-[#181820]"
              }`}
            >
              <button
                type="button"
                aria-label={`Select ${agent.name}`}
                onClick={() => onSelect(agent)}
                className="absolute inset-0 z-0 rounded-2xl"
              />

              {onConfigure ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onConfigure(agent);
                  }}
                  className="absolute right-2 top-2 z-20 rounded-md border border-[#30303a] bg-[#0f0f12] px-2 py-1 text-[10px] font-medium text-gray-300 hover:border-[#4a4a54] hover:text-white"
                >
                  Config
                </button>
              ) : null}

              <div className="pointer-events-none relative z-10 flex h-full flex-col">
                <div className="mb-2 text-2xl">{agent.icon}</div>
                <p className="text-sm font-semibold text-gray-100">{agent.name}</p>
                {isHero ? <p className="mt-1 text-xs text-gray-400">{agent.description}</p> : null}

                <div className="mt-auto flex items-center justify-between pt-2">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      isActive ? "bg-[#163525] text-[#9ff1c5]" : "bg-[#2a2a31] text-gray-300"
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${isActive ? "bg-[#4ade80]" : "bg-[#9ca3af]"}`} />
                    {isActive ? "active" : "idle"}
                  </span>
                  {isHero ? (
                    <span className="rounded-md border border-[#2e2e38] bg-[#101018] px-2 py-0.5 text-[10px] text-gray-300">
                      Start
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
