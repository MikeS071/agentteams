"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  formatApprovalTime,
  HANDS_SSE_EVENT_NAMES,
  hydrateApprovalsFromStorage,
  parseApprovalEvent,
  persistApprovalsToStorage,
  removeApprovalItem,
  type ApprovalItem,
  type ApprovalRisk,
  upsertApprovalItem,
} from "@/lib/approvals";

type ActionState = "idle" | "loading";
type Decision = "approve" | "reject";

function riskClassName(risk: ApprovalRisk): string {
  switch (risk) {
    case "low":
      return "bg-emerald-500/15 text-emerald-300 border-emerald-500/40";
    case "medium":
      return "bg-amber-500/15 text-amber-300 border-amber-500/40";
    case "high":
      return "bg-orange-500/15 text-orange-300 border-orange-500/40";
    case "critical":
      return "bg-rose-500/15 text-rose-300 border-rose-500/40";
    default:
      return "bg-slate-500/15 text-slate-300 border-slate-500/30";
  }
}

async function sendDecision(item: ApprovalItem, decision: Decision): Promise<void> {
  const response = await fetch(`/api/hands/${encodeURIComponent(item.handId)}/${decision}/${encodeURIComponent(item.actionId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    let message = `Failed to ${decision} action`;
    try {
      const payload = (await response.json()) as { error?: string; message?: string };
      message = payload.error || payload.message || message;
    } catch {
      // Keep default message.
    }
    throw new Error(message);
  }
}

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [selected, setSelected] = useState<ApprovalItem | null>(null);
  const [statusByKey, setStatusByKey] = useState<Record<string, ActionState>>({});
  const [streamConnected, setStreamConnected] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [bulkLoading, setBulkLoading] = useState<Decision | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setApprovals(hydrateApprovalsFromStorage());

    const source = new EventSource("/api/hands/events");

    source.onopen = () => {
      setStreamConnected(true);
      setStreamError(null);
    };

    const handleEvent = (event: MessageEvent) => {
      const parsed = parseApprovalEvent(event.data);
      if (!parsed) {
        return;
      }

      setApprovals((current) => {
        if (parsed.type === "required") {
          return upsertApprovalItem(current, parsed.item);
        }
        return removeApprovalItem(current, parsed.handId, parsed.actionId);
      });
    };
    source.onmessage = handleEvent;
    HANDS_SSE_EVENT_NAMES.forEach((eventName) => {
      source.addEventListener(eventName, handleEvent as EventListener);
    });

    source.onerror = () => {
      setStreamConnected(false);
      setStreamError("Disconnected from approval event stream. Reconnecting...");
    };

    return () => {
      HANDS_SSE_EVENT_NAMES.forEach((eventName) => {
        source.removeEventListener(eventName, handleEvent as EventListener);
      });
      source.close();
    };
  }, []);

  useEffect(() => {
    persistApprovalsToStorage(approvals);
  }, [approvals]);

  const pendingCount = approvals.length;

  const runDecision = useCallback(async (item: ApprovalItem, decision: Decision) => {
    const key = `${item.handId}::${item.actionId}`;
    setStatusByKey((current) => ({ ...current, [key]: "loading" }));
    setActionError(null);

    try {
      await sendDecision(item, decision);
      setApprovals((current) => removeApprovalItem(current, item.handId, item.actionId));
      setSelected((current) => {
        if (!current) {
          return null;
        }
        return current.handId === item.handId && current.actionId === item.actionId ? null : current;
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : `Failed to ${decision} action`);
    } finally {
      setStatusByKey((current) => ({ ...current, [key]: "idle" }));
    }
  }, []);

  const runBulkDecision = useCallback(
    async (decision: Decision) => {
      if (approvals.length === 0) {
        return;
      }

      setBulkLoading(decision);
      setActionError(null);

      const results = await Promise.allSettled(
        approvals.map(async (item) => {
          await sendDecision(item, decision);
          return item;
        })
      );

      const failed = results.filter((result) => result.status === "rejected");
      const succeeded = results
        .map((result, index) => ({ result, index }))
        .filter(({ result }) => result.status === "fulfilled")
        .map(({ index }) => approvals[index]);

      if (succeeded.length > 0) {
        const removalKeys = new Set(succeeded.map((item) => `${item.handId}::${item.actionId}`));
        setApprovals((current) => current.filter((item) => !removalKeys.has(`${item.handId}::${item.actionId}`)));
      }

      if (failed.length > 0) {
        setActionError(`${failed.length} action(s) failed to ${decision}.`);
      }

      setBulkLoading(null);
    },
    [approvals]
  );

  const selectedStatus = useMemo(() => {
    if (!selected) {
      return "idle";
    }
    return statusByKey[`${selected.handId}::${selected.actionId}`] ?? "idle";
  }, [selected, statusByKey]);

  return (
    <div className="h-full overflow-y-auto bg-[#0a0a0f] px-4 py-5 sm:px-6">
      <div className="mx-auto w-full max-w-6xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-100">Approval Queue</h1>
            <p className="mt-1 text-sm text-gray-400">Review and approve or reject sensitive Hand actions.</p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span
              className={`rounded-full border px-2.5 py-1 ${
                streamConnected ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-amber-500/40 bg-amber-500/10 text-amber-300"
              }`}
            >
              {streamConnected ? "Live" : "Reconnecting"}
            </span>
            <span className="rounded-full border border-[#2b2b40] bg-[#131322] px-2.5 py-1 text-gray-300">
              {pendingCount} pending
            </span>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void runBulkDecision("approve")}
            disabled={pendingCount === 0 || bulkLoading !== null}
            className="rounded-md border border-emerald-500/50 bg-emerald-500/15 px-3 py-1.5 text-sm font-medium text-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {bulkLoading === "approve" ? "Approving..." : "Approve All"}
          </button>
          <button
            type="button"
            onClick={() => void runBulkDecision("reject")}
            disabled={pendingCount === 0 || bulkLoading !== null}
            className="rounded-md border border-rose-500/50 bg-rose-500/15 px-3 py-1.5 text-sm font-medium text-rose-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {bulkLoading === "reject" ? "Rejecting..." : "Reject All"}
          </button>
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-[#222235]">
          <table className="min-w-full divide-y divide-[#222235] text-sm">
            <thead className="bg-[#10101a] text-gray-400">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Hand</th>
                <th className="px-3 py-2 text-left font-medium">Action</th>
                <th className="px-3 py-2 text-left font-medium">Risk</th>
                <th className="px-3 py-2 text-left font-medium">Requested</th>
                <th className="px-3 py-2 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1b1b2b] bg-[#0d0d16] text-gray-200">
              {approvals.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-center text-gray-500" colSpan={5}>
                    No pending approvals.
                  </td>
                </tr>
              ) : (
                approvals.map((item) => {
                  const key = `${item.handId}::${item.actionId}`;
                  const loading = statusByKey[key] === "loading" || bulkLoading !== null;

                  return (
                    <tr key={key}>
                      <td className="px-3 py-3">
                        <p className="font-medium text-gray-100">{item.handName}</p>
                        <p className="font-mono text-xs text-gray-500">{item.handId}</p>
                      </td>
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          onClick={() => setSelected(item)}
                          className="text-left text-gray-200 hover:text-white"
                        >
                          {item.actionDescription}
                        </button>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${riskClassName(item.riskLevel)}`}>
                          {item.riskLevel}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-gray-400">{formatApprovalTime(item.timestamp)}</td>
                      <td className="px-3 py-3">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => void runDecision(item, "approve")}
                            disabled={loading}
                            className="rounded-md border border-emerald-500/40 px-2.5 py-1 text-xs font-medium text-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => void runDecision(item, "reject")}
                            disabled={loading}
                            className="rounded-md border border-rose-500/40 px-2.5 py-1 text-xs font-medium text-rose-300 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {streamError ? <p className="mt-3 text-sm text-amber-300">{streamError}</p> : null}
        {actionError ? <p className="mt-2 text-sm text-rose-300">{actionError}</p> : null}
      </div>

      {selected ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-2xl rounded-xl border border-[#2a2a40] bg-[#0f0f18]">
            <div className="flex items-center justify-between border-b border-[#212138] px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-100">Approval Details</h2>
                <p className="text-xs text-gray-500">{selected.handName}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded-md border border-[#2a2a40] px-2.5 py-1 text-sm text-gray-300"
              >
                Close
              </button>
            </div>

            <div className="space-y-4 px-5 py-4 text-sm">
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500">What the Hand wants to do</p>
                <p className="mt-1 text-gray-100">{selected.actionDescription}</p>
              </div>

              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500">Why</p>
                <p className="mt-1 text-gray-300">{selected.reason || "No reason provided."}</p>
              </div>

              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500">Tools involved</p>
                {selected.tools.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-2">
                    {selected.tools.map((tool) => (
                      <span key={tool} className="rounded-md border border-[#32324c] bg-[#17172a] px-2 py-0.5 text-xs text-gray-300">
                        {tool}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-1 text-gray-400">No tool metadata provided.</p>
                )}
              </div>

              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500">Full context</p>
                <p className="mt-1 whitespace-pre-wrap text-gray-300">{selected.context || "No additional context provided."}</p>
              </div>

              {selected.preview ? (
                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-500">Action preview</p>
                  <pre className="mt-1 overflow-x-auto rounded-lg border border-[#2b2b43] bg-[#131324] p-3 text-xs text-gray-200">
                    {selected.preview}
                  </pre>
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[#212138] px-5 py-4">
              <button
                type="button"
                onClick={() => void runDecision(selected, "reject")}
                disabled={selectedStatus === "loading"}
                className="rounded-md border border-rose-500/50 bg-rose-500/15 px-3 py-1.5 text-sm font-medium text-rose-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Reject
              </button>
              <button
                type="button"
                onClick={() => void runDecision(selected, "approve")}
                disabled={selectedStatus === "loading"}
                className="rounded-md border border-emerald-500/50 bg-emerald-500/15 px-3 py-1.5 text-sm font-medium text-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Approve
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
