"use client";

import type { AgentType } from "@/lib/agents";

type Props = {
  agents: AgentType[];
  activeAgentId: string;
  onSelect: (agent: AgentType) => void;
};

export default function AgentModeSelector({ agents, activeAgentId, onSelect }: Props) {
  return (
    <div className="border-b border-[#1a1a1f] bg-[#0d0f14] px-3 py-2 sm:px-4">
      <div className="mx-auto flex w-full max-w-4xl items-center gap-2 overflow-x-auto">
        {agents.map((agent) => {
          const isActive = activeAgentId === agent.id;
          return (
            <button
              key={agent.id}
              type="button"
              onClick={() => onSelect(agent)}
              className={`inline-flex items-center gap-2 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                isActive
                  ? "border-[#2f8f5b] bg-[#13251c] text-[#b8f7d8]"
                  : "border-[#2b2f39] bg-[#11141b] text-gray-300 hover:border-[#3a4355] hover:text-white"
              }`}
              aria-label={`Switch to ${agent.name}`}
              title={agent.name}
            >
              <span>{agent.icon}</span>
              <span className="hidden sm:inline">{agent.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
