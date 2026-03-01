import type { CSSProperties, ReactNode } from "react";

type Props = {
  agentId: string;
  chatPanel: ReactNode;
  sidePanel?: ReactNode;
  splitRatio?: string;
};

export default function AgentModeLayout({ agentId, chatPanel, sidePanel, splitRatio = "1fr 1fr" }: Props) {
  if (!sidePanel) {
    return <div className="min-h-0 flex-1 overflow-hidden">{chatPanel}</div>;
  }

  return (
    <div
      data-agent-id={agentId}
      style={{ "--split": splitRatio } as CSSProperties}
      className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 md:[grid-template-columns:var(--split)] md:p-4"
    >
      <div className="min-h-0 overflow-hidden rounded-2xl border border-[#1f1f2a] bg-[#0e0e14]">{chatPanel}</div>
      <div className="min-h-0 overflow-hidden rounded-2xl border border-[#1f1f2a] bg-[#0e0e14]">{sidePanel}</div>
    </div>
  );
}
