"use client";

import { AGENTS, type AgentType } from "@/lib/agents";

type Props = {
  selected: string;
  onSelect: (agent: AgentType) => void;
};

export default function AgentPicker({ selected, onSelect }: Props) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
      {AGENTS.map((agent) => (
        <button
          key={agent.id}
          type="button"
          onClick={() => onSelect(agent)}
          className={`flex flex-col items-center gap-1 rounded-xl border p-3 text-center transition-all ${
            selected === agent.id
              ? "border-[#6c5ce7] bg-[#6c5ce7]/10 text-white"
              : "border-[#2a2a3d] bg-[#12121a] text-gray-400 hover:border-[#3a3a5d] hover:text-gray-200"
          }`}
        >
          <span className="text-2xl">{agent.icon}</span>
          <span className="text-xs font-medium leading-tight">{agent.name}</span>
        </button>
      ))}
    </div>
  );
}
