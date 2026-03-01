"use client";

import { useMemo, useState } from "react";
import QuickActionModal from "@/components/QuickActionModal";
import type { QuickAction } from "@/lib/quick-actions";

type Props = {
  agentId: string;
  agentLabel: string;
  actions: QuickAction[];
  onSubmit: (prompt: string) => void;
};

export default function QuickActionBar({ agentId, agentLabel, actions, onSubmit }: Props) {
  const [activeActionId, setActiveActionId] = useState<string | null>(null);

  const activeAction = useMemo(() => actions.find((action) => action.id === activeActionId) ?? null, [actions, activeActionId]);

  return (
    <>
      <div className="border-t border-[#1f1f2a] bg-[#0f0f16] px-3 py-2 sm:px-4">
        <div className="mx-auto flex w-full max-w-4xl items-center gap-2 overflow-x-auto">
          <span className="inline-flex shrink-0 items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300">
            {agentLabel}
          </span>

          {actions.map((action) => (
            <button
              key={`${agentId}-${action.id}`}
              type="button"
              onClick={() => setActiveActionId(action.id)}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#24242c] px-3 py-1.5 text-sm text-gray-200 transition-colors hover:border-[#3a3a44] hover:bg-[#131320]"
            >
              <span>{action.icon ?? "▶"}</span>
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      </div>

      <QuickActionModal
        action={activeAction}
        open={Boolean(activeAction)}
        onClose={() => setActiveActionId(null)}
        onSubmit={onSubmit}
      />
    </>
  );
}
