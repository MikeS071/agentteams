import type { ReactNode } from "react";

type AgentModeLayoutProps = {
  agentId: string;
  chatPanel: ReactNode;
  sidePanel?: ReactNode;
  splitRatio?: string;
};

export default function AgentModeLayout({ agentId, chatPanel, sidePanel, splitRatio }: AgentModeLayoutProps) {
  const hasSidePanel = Boolean(sidePanel);
  const gridTemplateColumns = hasSidePanel
    ? (splitRatio ?? "minmax(0, 1fr) minmax(0, 1fr)")
    : (splitRatio ?? "minmax(0, 1fr)");

  return (
    <div
      data-agent-mode={agentId}
      className="grid min-h-0 flex-1 gap-4 px-3 py-4 sm:px-5"
      style={{ gridTemplateColumns }}
    >
      <div className="min-h-0 min-w-0">{chatPanel}</div>
      {hasSidePanel && <aside className="min-h-0 min-w-0 overflow-y-auto">{sidePanel}</aside>}
    </div>
  );
}
