"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getRunDisplayStatus,
  RunSnapshot,
  upsertTrackedRun,
  WorkflowTemplate,
  writeTrackedRuns,
  readTrackedRuns,
} from "@/lib/workflows-client";

type TemplatesResponse = {
  templates: WorkflowTemplate[];
};

type ConfirmResponse = {
  run?: RunSnapshot["run"];
  next_step?: RunSnapshot["next_step"];
  brief?: string;
  rejected?: boolean;
};

function statusBadge(status: string): string {
  if (status === "confirmed") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
  if (status === "awaiting_confirmation") return "border-amber-500/40 bg-amber-500/10 text-amber-200";
  if (status === "rejected") return "border-red-500/40 bg-red-500/10 text-red-200";
  if (status === "in_progress") return "border-sky-500/40 bg-sky-500/10 text-sky-200";
  return "border-gray-500/40 bg-gray-500/10 text-gray-200";
}

export default function WorkflowRunPage() {
  const params = useParams<{ runId: string }>();
  const runId = params.runId;

  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stepInput, setStepInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [brief, setBrief] = useState<string | null>(null);
  const [rejected, setRejected] = useState(false);

  useEffect(() => {
    const existing = readTrackedRuns().find((run) => run.id === runId);
    if (existing?.rejected) {
      setRejected(true);
    }
  }, [runId]);

  const workflow = useMemo(() => {
    if (!snapshot) return null;
    return templates.find((template) => template.id === snapshot.run.workflow_id) ?? null;
  }, [snapshot, templates]);

  const progress = useMemo(() => {
    if (!snapshot || !workflow || workflow.stepCount === 0) return 0;
    return Math.min(100, Math.round((snapshot.run.current_step / workflow.stepCount) * 100));
  }, [snapshot, workflow]);

  const refresh = useCallback(async () => {
    try {
      const [runResponse, templatesResponse] = await Promise.all([
        fetch(`/api/workflows/runs/${runId}`, { cache: "no-store" }),
        fetch("/api/workflows/templates", { cache: "no-store" }),
      ]);

      if (!runResponse.ok) {
        throw new Error("Failed to load run");
      }

      const runPayload = (await runResponse.json()) as RunSnapshot;
      const templatePayload = templatesResponse.ok
        ? ((await templatesResponse.json()) as TemplatesResponse)
        : { templates: [] };

      setSnapshot(runPayload);
      setTemplates(templatePayload.templates ?? []);

      if (runPayload.next_step) {
        if (runPayload.next_step.type === "choice") {
          const fallback = runPayload.next_step.options?.[0] ?? "";
          setStepInput(runPayload.next_step.default ?? fallback);
        } else {
          setStepInput(runPayload.next_step.default ?? "");
        }
      }

      const templateName =
        templatePayload.templates.find((template) => template.id === runPayload.run.workflow_id)?.name ??
        runPayload.run.workflow_id;

      const status = getRunDisplayStatus(runPayload, rejected);
      const existing = readTrackedRuns().find((run) => run.id === runPayload.run.id);
      upsertTrackedRun({
        id: runPayload.run.id,
        workflowId: runPayload.run.workflow_id,
        workflowName: templateName,
        startedAt: existing?.startedAt ?? new Date().toISOString(),
        status,
        rejected: existing?.rejected ?? rejected,
      });
    } catch (refreshError) {
      console.error(refreshError);
      setError("Unable to load workflow run.");
    } finally {
      setLoading(false);
    }
  }, [runId, rejected]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const poller = window.setInterval(() => {
      void refresh();
    }, 4000);

    return () => {
      window.clearInterval(poller);
    };
  }, [refresh]);

  async function submitStep(input: string) {
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/workflows/runs/${runId}/step`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to submit step");
      }

      setSnapshot({ run: payload.run, next_step: payload.next_step ?? null });
      setStepInput(payload.next_step?.default ?? "");
    } catch (submitError) {
      console.error(submitError);
      setError("Unable to submit workflow step.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function finalizeRun(decision: "confirm" | "reject") {
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/workflows/runs/${runId}/confirm`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ decision }),
      });

      const payload = (await response.json()) as ConfirmResponse;
      if (!response.ok || !payload.run) {
        throw new Error("Failed to finalize workflow");
      }

      if (decision === "reject") {
        setRejected(true);
      }

      if (payload.brief) {
        setBrief(payload.brief);
      }

      setSnapshot({
        run: payload.run,
        next_step: payload.next_step ?? null,
      });

      const existing = readTrackedRuns();
      const next = existing.map((run) =>
        run.id === runId
          ? {
              ...run,
              status: decision === "reject" ? "rejected" : "confirmed",
              rejected: decision === "reject",
            }
          : run
      );
      writeTrackedRuns(next);
    } catch (confirmError) {
      console.error(confirmError);
      setError("Unable to submit confirmation action.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-400">Loading workflow run...</div>
    );
  }

  if (error && !snapshot) {
    return (
      <div className="h-full overflow-y-auto bg-[#0a0a0f] px-4 py-6 sm:px-6">
        <div className="mx-auto max-w-5xl rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-400">Workflow run not found.</div>
    );
  }

  const status = getRunDisplayStatus(snapshot, rejected);
  const awaitingFinalConfirmation = !snapshot.next_step && snapshot.run.status === "in_progress" && !rejected;

  return (
    <div className="h-full overflow-y-auto bg-[#0a0a0f] px-4 py-6 sm:px-6">
      <div className="mx-auto w-full max-w-5xl space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-100">{workflow?.name ?? snapshot.run.workflow_id}</h1>
            <p className="mt-1 text-sm text-gray-400">Run ID: {snapshot.run.id}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-md border px-2 py-1 text-xs font-medium ${statusBadge(status)}`}>
              {status.replace("_", " ")}
            </span>
            <Link
              href="/dashboard/workflows"
              className="rounded-md border border-[#34344d] px-3 py-1.5 text-sm text-gray-200 hover:bg-[#171723]"
            >
              Back to catalog
            </Link>
          </div>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
        ) : null}

        <section className="rounded-xl border border-[#1f1f30] bg-[#11111a] p-5">
          <div className="flex items-center justify-between text-sm text-gray-300">
            <span>Progress</span>
            <span>{progress}%</span>
          </div>
          <div className="mt-2 h-2 rounded-full bg-[#1b1b2a]">
            <div className="h-2 rounded-full bg-[#6c5ce7]" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Step {snapshot.run.current_step} of {workflow?.stepCount ?? 0}
          </p>
        </section>

        {snapshot.next_step ? (
          <section className="rounded-xl border border-[#1f1f30] bg-[#11111a] p-5">
            <h2 className="text-lg font-medium text-gray-100">Current Step</h2>
            <p className="mt-2 text-sm text-gray-200">{snapshot.next_step.prompt}</p>
            {snapshot.next_step.help ? <p className="mt-1 text-xs text-gray-500">{snapshot.next_step.help}</p> : null}

            {snapshot.next_step.type === "choice" ? (
              <select
                value={stepInput}
                onChange={(event) => setStepInput(event.target.value)}
                className="mt-4 w-full rounded-md border border-[#2f2f45] bg-[#0d0d14] px-3 py-2 text-sm text-gray-100"
              >
                {(snapshot.next_step.options ?? []).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : snapshot.next_step.type === "confirm" ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => void submitStep("Yes")}
                  className="rounded-md bg-[#6c5ce7] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  Confirm Step
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => void submitStep("No")}
                  className="rounded-md border border-[#3b3b54] px-3 py-2 text-sm text-gray-200 hover:bg-[#171723] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  Reject Step
                </button>
              </div>
            ) : (
              <div>
                <textarea
                  value={stepInput}
                  onChange={(event) => setStepInput(event.target.value)}
                  rows={4}
                  placeholder="Enter step response"
                  className="mt-4 w-full rounded-md border border-[#2f2f45] bg-[#0d0d14] px-3 py-2 text-sm text-gray-100"
                />
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => void submitStep(stepInput)}
                  className="mt-3 rounded-md bg-[#6c5ce7] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isSubmitting ? "Submitting..." : "Submit Step"}
                </button>
              </div>
            )}
          </section>
        ) : null}

        {awaitingFinalConfirmation ? (
          <section className="rounded-xl border border-[#1f1f30] bg-[#11111a] p-5">
            <h2 className="text-lg font-medium text-gray-100">Human Confirmation Required</h2>
            <p className="mt-2 text-sm text-gray-300">
              All workflow steps are complete. Confirm to finalize this run or reject to stop before finalization.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => void finalizeRun("confirm")}
                className="rounded-md bg-[#6c5ce7] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
              >
                Confirm
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => void finalizeRun("reject")}
                className="rounded-md border border-[#3b3b54] px-3 py-2 text-sm text-gray-200 hover:bg-[#171723] disabled:cursor-not-allowed disabled:opacity-70"
              >
                Reject
              </button>
            </div>
          </section>
        ) : null}

        <section className="rounded-xl border border-[#1f1f30] bg-[#11111a] p-5">
          <h2 className="text-lg font-medium text-gray-100">Step History</h2>
          {workflow?.steps?.length ? (
            <ol className="mt-3 space-y-2">
              {workflow.steps.map((step, index) => {
                const value = snapshot.run.inputs[step.id];
                const isCompleted = typeof value === "string";
                const isCurrent = snapshot.next_step?.id === step.id;

                return (
                  <li key={step.id} className="rounded-md border border-[#232336] bg-[#0d0d14] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-gray-100">
                        {index + 1}. {step.prompt}
                      </p>
                      <span className="text-xs text-gray-500">
                        {isCompleted ? "Completed" : isCurrent ? "Current" : "Pending"}
                      </span>
                    </div>
                    {isCompleted ? <p className="mt-1 text-sm text-gray-300">{value}</p> : null}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="mt-3 text-sm text-gray-400">Step details are unavailable for this run.</p>
          )}
        </section>

        {brief ? (
          <section className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-5">
            <h2 className="text-lg font-medium text-emerald-100">Compiled Brief</h2>
            <pre className="mt-3 whitespace-pre-wrap text-sm text-emerald-50">{brief}</pre>
          </section>
        ) : null}
      </div>
    </div>
  );
}
