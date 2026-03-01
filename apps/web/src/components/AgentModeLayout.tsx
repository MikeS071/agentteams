"use client";

import type { CSSProperties, ReactNode } from "react";

type Props = {
  agentId: string;
  chatPanel: ReactNode;
  sidePanel?: ReactNode;
  splitRatio?: string;
};

export default function AgentModeLayout({ agentId, chatPanel, sidePanel, splitRatio }: Props) {
  const hasSidePanel = Boolean(sidePanel);
  const style = hasSidePanel
    ? ({ "--agent-mode-split": splitRatio || "1fr 1fr" } as CSSProperties)
    : undefined;

  return (
    <div data-agent-mode={agentId} className="min-h-0 flex-1 overflow-hidden p-3 sm:p-4">
      <div
        className={`grid h-full min-h-0 gap-3 ${
          hasSidePanel ? "grid-cols-1 xl:[grid-template-columns:var(--agent-mode-split)]" : "grid-cols-1"
        }`}
        style={style}
      >
        <div className="min-h-0">{chatPanel}</div>
        {hasSidePanel ? <div className="min-h-0">{sidePanel}</div> : null}
      </div>
    </div>
  );
}
