"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getRunDisplayStatus,
  readTrackedRuns,
  RunSnapshot,
  TrackedWorkflowRun,
  upsertTrackedRun,
  WorkflowTemplate,
  writeTrackedRuns,
} from "@/lib/workflows-client";

type TemplatesResponse = {
  templates: WorkflowTemplate[];
};

type StartResponse = {
  run?: {
    id: string;
    workflow_id: string;
    status: string;
  };
};

function statusBadge(status: string): string {
  if (status === "confirmed") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
  if (status === "awaiting_confirmation") return "border-amber-500/40 bg-amber-500/10 text-amber-200";
  if (status === "rejected") return "border-red-500/40 bg-red-500/10 text-red-200";
  if (status === "in_progress") return "border-sky-500/40 bg-sky-500/10 text-sky-200";
  return "border-gray-500/40 bg-gray-500/10 text-gray-200";
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
}

export default function WorkflowCatalogPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [trackedRuns, setTrackedRuns] = useState<TrackedWorkflowRun[]>([]);
  const [runSnapshots, setRunSnapshots] = useState<Record<string, RunSnapshot>>({});
  const [activeTab, setActiveTab] = useState<"active" | "completed">("active");
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startingTemplateId, setStartingTemplateId] = useState<string | null>(null);

  const refreshRunStatuses = useCallback(async (runs: TrackedWorkflowRun[]) => {
    if (runs.length === 0) {
      setRunSnapshots({});
      return;
    }

    const results = await Promise.all(
      runs.map(async (trackedRun) => {
        try {
          const response = await fetch(`/api/workflows/runs/${trackedRun.id}`, { cache: "no-store" });
          if (!response.ok) return null;
          const payload = (await response.json()) as RunSnapshot;
          if (!payload.run) return null;
          return { runId: trackedRun.id, snapshot: payload };
        } catch {
          return null;
        }
      })
    );

    const nextSnapshots: Record<string, RunSnapshot> = {};
    const nextTracked = [...runs];

    for (const result of results) {
      if (!result) continue;
      nextSnapshots[result.runId] = result.snapshot;

      const index = nextTracked.findIndex((item) => item.id === result.runId);
      if (index >= 0) {
        nextTracked[index] = {
          ...nextTracked[index],
          status: getRunDisplayStatus(result.snapshot, nextTracked[index].rejected),
        };
      }
    }

    setRunSnapshots(nextSnapshots);
    setTrackedRuns(nextTracked);
    writeTrackedRuns(nextTracked);
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadTemplates() {
      try {
        const response = await fetch("/api/workflows/templates", { cache: "no-store" });
        if (!response.ok) {
          throw new Error("Failed to load templates");
        }

        const payload = (await response.json()) as TemplatesResponse;
        if (!isMounted) return;

        setTemplates(payload.templates ?? []);
      } catch (loadError) {
        console.error(loadError);
        if (isMounted) {
          setError("Unable to load workflow templates.");
        }
      } finally {
        if (isMounted) {
          setLoadingTemplates(false);
        }
      }
    }

    const runs = readTrackedRuns();
    setTrackedRuns(runs);

    void loadTemplates();
    void refreshRunStatuses(runs);

    return () => {
      isMounted = false;
    };
  }, [refreshRunStatuses]);

  useEffect(() => {
    const poller = window.setInterval(() => {
      void refreshRunStatuses(readTrackedRuns());
    }, 5000);

    return () => {
      window.clearInterval(poller);
    };
  }, [refreshRunStatuses]);

  const activeRuns = useMemo(() => {
    return trackedRuns.filter((trackedRun) => {
      const status = getRunDisplayStatus(runSnapshots[trackedRun.id] ?? null, trackedRun.rejected);
      return status !== "confirmed" && status !== "rejected";
    });
  }, [trackedRuns, runSnapshots]);

  const completedRuns = useMemo(() => {
    return trackedRuns.filter((trackedRun) => {
      const status = getRunDisplayStatus(runSnapshots[trackedRun.id] ?? null, trackedRun.rejected);
      return status === "confirmed" || status === "rejected";
    });
  }, [trackedRuns, runSnapshots]);

  async function startWorkflow(template: WorkflowTemplate) {
    setStartingTemplateId(template.id);
    setError(null);

    try {
      const response = await fetch("/api/workflows/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ templateName: template.id }),
      });

      const payload = (await response.json()) as StartResponse;
      if (!response.ok || !payload.run?.id) {
        throw new Error("Failed to start workflow");
      }

      const updatedRuns = upsertTrackedRun({
        id: payload.run.id,
        workflowId: template.id,
        workflowName: template.name,
        startedAt: new Date().toISOString(),
        status: "in_progress",
      });
      setTrackedRuns(updatedRuns);
      router.push(`/dashboard/workflows/${payload.run.id}`);
    } catch (startError) {
      console.error(startError);
      setError("Unable to start workflow.");
    } finally {
      setStartingTemplateId(null);
    }
  }

  const displayedRuns = activeTab === "active" ? activeRuns : completedRuns;

  return (
    <div className="h-full overflow-y-auto bg-[#0a0a0f] px-4 py-6 sm:px-6">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <section>
          <h1 className="text-2xl font-semibold text-gray-100">Workflow Catalog</h1>
          <p className="mt-2 text-sm text-gray-400">
            Start from a template, track active runs, and complete approval steps.
          </p>
        </section>

        {error ? (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
        ) : null}

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium text-gray-100">Templates</h2>
            <button
              type="button"
              onClick={() => void refreshRunStatuses(readTrackedRuns())}
              className="rounded-md border border-[#34344d] px-3 py-1.5 text-sm text-gray-200 hover:bg-[#171723]"
            >
              Refresh
            </button>
          </div>

          {loadingTemplates ? (
            <div className="rounded-xl border border-[#1f1f30] bg-[#11111a] p-4 text-sm text-gray-400">Loading templates...</div>
          ) : templates.length === 0 ? (
            <div className="rounded-xl border border-[#1f1f30] bg-[#11111a] p-4 text-sm text-gray-400">
              No workflow templates found.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {templates.map((template) => (
                <article
                  key={template.id}
                  className="rounded-xl border border-[#1f1f30] bg-[#11111a] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-lg font-medium text-gray-100">{template.name}</h3>
                    <span className="text-lg">{template.icon || ""}</span>
                  </div>
                  <p className="mt-2 text-sm text-gray-400">{template.description}</p>

                  <dl className="mt-4 grid grid-cols-2 gap-2 text-sm text-gray-300">
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-gray-500">Steps</dt>
                      <dd>{template.stepCount}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-gray-500">Est. Duration</dt>
                      <dd>{template.estimatedDuration}</dd>
                    </div>
                  </dl>

                  <button
                    type="button"
                    disabled={startingTemplateId === template.id}
                    onClick={() => void startWorkflow(template)}
                    className="mt-5 inline-flex w-full items-center justify-center rounded-md bg-[#6c5ce7] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {startingTemplateId === template.id ? "Starting..." : "Start"}
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium text-gray-100">Runs</h2>
            <div className="inline-flex rounded-md border border-[#34344d] bg-[#11111a] p-1">
              <button
                type="button"
                onClick={() => setActiveTab("active")}
                className={`rounded px-3 py-1.5 text-sm ${
                  activeTab === "active" ? "bg-[#1f1f30] text-gray-100" : "text-gray-400"
                }`}
              >
                Active ({activeRuns.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("completed")}
                className={`rounded px-3 py-1.5 text-sm ${
                  activeTab === "completed" ? "bg-[#1f1f30] text-gray-100" : "text-gray-400"
                }`}
              >
                Completed ({completedRuns.length})
              </button>
            </div>
          </div>

          {displayedRuns.length === 0 ? (
            <div className="rounded-xl border border-[#1f1f30] bg-[#11111a] p-4 text-sm text-gray-400">
              No {activeTab} runs yet.
            </div>
          ) : (
            <div className="space-y-3">
              {displayedRuns.map((trackedRun) => {
                const snapshot = runSnapshots[trackedRun.id] ?? null;
                const status = getRunDisplayStatus(snapshot, trackedRun.rejected);

                return (
                  <article
                    key={trackedRun.id}
                    className="rounded-xl border border-[#1f1f30] bg-[#11111a] p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-100">{trackedRun.workflowName}</p>
                        <p className="text-xs text-gray-500">
                          Run: {trackedRun.id} · Started {formatDateTime(trackedRun.startedAt)}
                        </p>
                      </div>

                      <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-medium ${statusBadge(status)}`}>
                        {status.replace("_", " ")}
                      </span>
                    </div>

                    <div className="mt-3">
                      <Link
                        href={`/dashboard/workflows/${trackedRun.id}`}
                        className="inline-flex items-center rounded-md border border-[#34344d] px-3 py-1.5 text-sm text-gray-200 hover:bg-[#171723]"
                      >
                        View run
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
