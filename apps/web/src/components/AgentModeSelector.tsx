import type { AgentType } from "@/lib/agents";

type Props = {
  agents: AgentType[];
  activeAgentId: string;
  onSelect: (agent: AgentType) => void;
};

export default function AgentModeSelector({ agents, activeAgentId, onSelect }: Props) {
  return (
    <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
      {agents.map((agent) => {
        const isActive = activeAgentId === agent.id;
        return (
          <button
            key={agent.id}
            type="button"
            onClick={() => onSelect(agent)}
            title={agent.name}
            className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
              isActive
                ? "border-[#2f8f5b] bg-[#12221a] text-[#b9f5d5]"
                : "border-[#2b2b34] bg-[#13131b] text-gray-300 hover:border-[#3a3a45] hover:text-gray-100"
            }`}
          >
            <span>{agent.icon}</span>
            <span className="hidden sm:inline">{agent.name}</span>
          </button>
        );
      })}
    </div>
  );
}
