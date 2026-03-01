import type { ReactNode } from "react";

type AgentModeLayoutProps = {
  agentId: string;
  chatPanel: ReactNode;
  sidePanel?: ReactNode;
  splitRatio?: string;
};

export default function AgentModeLayout({ agentId, chatPanel, sidePanel, splitRatio }: AgentModeLayoutProps) {
  const gridTemplateColumns = splitRatio ?? (sidePanel ? "360px minmax(0, 1fr)" : "minmax(0, 1fr)");

  return (
    <div
      className="relative grid h-[calc(100vh-3rem)] max-h-[calc(100vh-3rem)] min-h-0 bg-[#0a0a0b]"
      style={{ gridTemplateColumns }}
      data-agent-id={agentId}
    >
      {sidePanel}
      {chatPanel}
    </div>
  );
}
