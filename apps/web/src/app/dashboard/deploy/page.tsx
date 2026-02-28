"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Provider = "vercel" | "supabase";
type Target = "vercel" | "supabase" | "both";

type Connection = {
  provider: Provider;
  providerUserId: string | null;
  connectedAt: string;
};

type DeployRun = {
  id: string;
  tenant_id: string;
  provider: Provider;
  target_name: string;
  status: "queued" | "running" | "succeeded" | "failed";
  external_id?: string;
  error?: string;
  logs: Array<{ timestamp: string; message: string }>;
  created_at: string;
  updated_at: string;
};

type ProjectDraft = {
  id: string;
  name: string;
  repoUrl: string;
  branch: string;
  target: Target;
  vercelTeamId: string;
  vercelFramework: string;
  vercelRootDirectory: string;
  supabaseOrgId: string;
  supabaseRegion: string;
  supabaseDbPassword: string;
  supabaseMigrations: string;
};

const providerLabel: Record<Provider, string> = {
  vercel: "Vercel",
  supabase: "Supabase",
};

function createProjectDraft(index: number): ProjectDraft {
  return {
    id: `project-${Date.now()}-${index}`,
    name: "",
    repoUrl: "",
    branch: "main",
    target: "both",
    vercelTeamId: "",
    vercelFramework: "",
    vercelRootDirectory: "",
    supabaseOrgId: "",
    supabaseRegion: "us-east-1",
    supabaseDbPassword: "",
    supabaseMigrations: "",
  };
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  return date.toLocaleString();
}

export default function DashboardDeployPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [projects, setProjects] = useState<ProjectDraft[]>([createProjectDraft(1)]);
  const [tokenInputs, setTokenInputs] = useState<Record<Provider, string>>({
    vercel: "",
    supabase: "",
  });
  const [tokenStatus, setTokenStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [savingProvider, setSavingProvider] = useState<Provider | null>(null);
  const [startingProjectID, setStartingProjectID] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, DeployRun>>({});
  const pollRef = useRef<number | null>(null);

  const sortedRuns = useMemo(
    () =>
      Object.values(runs).sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      ),
    [runs]
  );

  const connectedProviders = useMemo(() => {
    const providers = new Set<Provider>();
    for (const connection of connections) {
      providers.add(connection.provider);
    }
    return providers;
  }, [connections]);

  const refreshConnections = useCallback(async () => {
    const response = await fetch("/api/deploy/tokens", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Failed to load deploy connections");
    }
    const payload = (await response.json()) as { connections?: Connection[] };
    setConnections(payload.connections ?? []);
  }, []);

  const pollRuns = useCallback(async () => {
    const activeIDs = Object.values(runs)
      .filter((run) => run.status === "queued" || run.status === "running")
      .map((run) => run.id);

    if (activeIDs.length === 0) {
      return;
    }

    await Promise.all(
      activeIDs.map(async (id) => {
        const response = await fetch(`/api/deploy/run/${encodeURIComponent(id)}`, {
          cache: "no-store",
        });
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as DeployRun;
        setRuns((prev) => ({ ...prev, [id]: payload }));
      })
    );
  }, [runs]);

  useEffect(() => {
    let cancelled = false;

    refreshConnections().catch((loadError) => {
      if (!cancelled) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load deploy page");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [refreshConnections]);

  useEffect(() => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }

    const hasActiveRuns = Object.values(runs).some(
      (run) => run.status === "queued" || run.status === "running"
    );
    if (!hasActiveRuns) {
      return;
    }

    pollRef.current = window.setInterval(() => {
      pollRuns().catch(() => {
        // Keep polling; individual fetch errors are surfaced in run status.
      });
    }, 2000);

    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [pollRuns, runs]);

  const saveProviderToken = async (provider: Provider) => {
    setError("");
    setTokenStatus("");
    setSavingProvider(provider);
    try {
      const token = tokenInputs[provider]?.trim();
      if (!token) {
        throw new Error(`Enter a ${providerLabel[provider]} token`);
      }

      const response = await fetch("/api/deploy/tokens", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ provider, token }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Token verification failed");
      }

      setTokenInputs((prev) => ({ ...prev, [provider]: "" }));
      setTokenStatus(`${providerLabel[provider]} connected`);
      await refreshConnections();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save token");
    } finally {
      setSavingProvider(null);
    }
  };

  const disconnectProvider = async (provider: Provider) => {
    setError("");
    setTokenStatus("");
    setSavingProvider(provider);
    try {
      const response = await fetch("/api/deploy/tokens", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ provider }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to disconnect provider");
      }
      await refreshConnections();
      setTokenStatus(`${providerLabel[provider]} disconnected`);
    } catch (disconnectError) {
      setError(
        disconnectError instanceof Error ? disconnectError.message : "Failed to disconnect provider"
      );
    } finally {
      setSavingProvider(null);
    }
  };

  const updateProject = (projectID: string, patch: Partial<ProjectDraft>) => {
    setProjects((prev) =>
      prev.map((project) => (project.id === projectID ? { ...project, ...patch } : project))
    );
  };

  const addProject = () => {
    setProjects((prev) => [...prev, createProjectDraft(prev.length + 1)]);
  };

  const removeProject = (projectID: string) => {
    setProjects((prev) => {
      if (prev.length <= 1) {
        return prev;
      }
      return prev.filter((project) => project.id !== projectID);
    });
  };

  const startDeploy = async (event: FormEvent, project: ProjectDraft) => {
    event.preventDefault();
    setError("");
    setTokenStatus("");
    setStartingProjectID(project.id);

    try {
      if (!project.name.trim()) {
        throw new Error("Project name is required");
      }
      if ((project.target === "vercel" || project.target === "both") && !connectedProviders.has("vercel")) {
        throw new Error("Connect Vercel token before deploying to Vercel");
      }
      if (
        (project.target === "supabase" || project.target === "both") &&
        !connectedProviders.has("supabase")
      ) {
        throw new Error("Connect Supabase token before deploying to Supabase");
      }
      if (
        (project.target === "supabase" || project.target === "both") &&
        (!project.supabaseOrgId.trim() || !project.supabaseDbPassword.trim())
      ) {
        throw new Error("Supabase org ID and DB password are required");
      }

      const response = await fetch("/api/deploy/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectName: project.name,
          repoUrl: project.repoUrl,
          branch: project.branch,
          target: project.target,
          vercel: {
            teamId: project.vercelTeamId,
            framework: project.vercelFramework,
            rootDirectory: project.vercelRootDirectory,
          },
          supabase:
            project.target === "supabase" || project.target === "both"
              ? {
                  orgId: project.supabaseOrgId,
                  region: project.supabaseRegion,
                  dbPassword: project.supabaseDbPassword,
                  migrations: project.supabaseMigrations
                    .split("\n---\n")
                    .map((item) => item.trim())
                    .filter(Boolean),
                }
              : undefined,
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        runs?: Array<{ id: string }>;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to start deployment");
      }

      const startedIDs = payload.runs?.map((run) => run.id) ?? [];
      if (startedIDs.length === 0) {
        throw new Error("No deployment run was returned");
      }

      await Promise.all(
        startedIDs.map(async (id) => {
          const statusResponse = await fetch(`/api/deploy/run/${encodeURIComponent(id)}`, {
            cache: "no-store",
          });
          if (!statusResponse.ok) {
            return;
          }
          const statusPayload = (await statusResponse.json()) as DeployRun;
          setRuns((prev) => ({ ...prev, [id]: statusPayload }));
        })
      );
    } catch (deployError) {
      setError(deployError instanceof Error ? deployError.message : "Failed to deploy");
    } finally {
      setStartingProjectID(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-[#0a0a0f] px-4 py-6 sm:px-6">
      <div className="mx-auto w-full max-w-6xl space-y-5">
        <div>
          <h1 className="text-2xl font-semibold text-gray-100">Deploy</h1>
          <p className="mt-1 text-sm text-gray-400">
            Connect providers, choose project targets, and monitor deployment status in real time.
          </p>
        </div>

        {tokenStatus ? (
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            {tokenStatus}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2">
          {(["vercel", "supabase"] as Provider[]).map((provider) => {
            const connection = connections.find((item) => item.provider === provider);
            const connecting = savingProvider === provider;
            return (
              <div
                key={provider}
                className="rounded-xl border border-[#1f1f30] bg-[#11111a] p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]"
              >
                <h2 className="text-lg font-medium text-gray-100">{providerLabel[provider]} token</h2>
                <p className="mt-1 text-sm text-gray-400">
                  {connection ? "Connected" : "Not connected"}
                  {connection?.providerUserId ? ` as ${connection.providerUserId}` : ""}
                </p>
                {connection ? (
                  <p className="mt-1 text-xs text-gray-500">
                    Connected at {formatDate(connection.connectedAt)}
                  </p>
                ) : null}

                <div className="mt-3 space-y-3">
                  <input
                    type="password"
                    value={tokenInputs[provider]}
                    onChange={(event) =>
                      setTokenInputs((prev) => ({ ...prev, [provider]: event.target.value }))
                    }
                    placeholder={`Paste ${providerLabel[provider]} API token`}
                    className="w-full rounded-md border border-[#2a2a3c] bg-[#0d0d14] px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:border-[#3f3f6a] focus:outline-none"
                  />

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => saveProviderToken(provider)}
                      disabled={connecting}
                      className="inline-flex items-center rounded-md bg-[#1f7aec] px-3 py-2 text-sm font-medium text-white hover:bg-[#2c86f8] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {connecting ? "Verifying..." : "Verify & Save"}
                    </button>
                    {connection ? (
                      <button
                        type="button"
                        onClick={() => disconnectProvider(provider)}
                        disabled={connecting}
                        className="inline-flex items-center rounded-md border border-[#32324a] px-3 py-2 text-sm font-medium text-gray-200 hover:bg-[#181826] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Disconnect
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium text-gray-100">Projects</h2>
            <button
              type="button"
              onClick={addProject}
              className="inline-flex items-center rounded-md border border-[#32324a] px-3 py-2 text-sm font-medium text-gray-200 hover:bg-[#181826]"
            >
              Add project
            </button>
          </div>

          {projects.map((project) => (
            <form
              key={project.id}
              onSubmit={(event) => startDeploy(event, project)}
              className="rounded-xl border border-[#1f1f30] bg-[#11111a] p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]"
            >
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-sm text-gray-300">Project name</span>
                  <input
                    value={project.name}
                    onChange={(event) => updateProject(project.id, { name: event.target.value })}
                    className="w-full rounded-md border border-[#2a2a3c] bg-[#0d0d14] px-3 py-2 text-sm text-gray-200 focus:border-[#3f3f6a] focus:outline-none"
                    placeholder="my-agent-app"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-sm text-gray-300">Target</span>
                  <select
                    value={project.target}
                    onChange={(event) =>
                      updateProject(project.id, { target: event.target.value as Target })
                    }
                    className="w-full rounded-md border border-[#2a2a3c] bg-[#0d0d14] px-3 py-2 text-sm text-gray-200 focus:border-[#3f3f6a] focus:outline-none"
                  >
                    <option value="both">Vercel + Supabase</option>
                    <option value="vercel">Vercel only</option>
                    <option value="supabase">Supabase only</option>
                  </select>
                </label>

                {(project.target === "vercel" || project.target === "both") && (
                  <>
                    <label className="space-y-1">
                      <span className="text-sm text-gray-300">Repository URL</span>
                      <input
                        value={project.repoUrl}
                        onChange={(event) => updateProject(project.id, { repoUrl: event.target.value })}
                        className="w-full rounded-md border border-[#2a2a3c] bg-[#0d0d14] px-3 py-2 text-sm text-gray-200 focus:border-[#3f3f6a] focus:outline-none"
                        placeholder="https://github.com/org/repo"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-sm text-gray-300">Branch</span>
                      <input
                        value={project.branch}
                        onChange={(event) => updateProject(project.id, { branch: event.target.value })}
                        className="w-full rounded-md border border-[#2a2a3c] bg-[#0d0d14] px-3 py-2 text-sm text-gray-200 focus:border-[#3f3f6a] focus:outline-none"
                        placeholder="main"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-sm text-gray-300">Vercel team ID (optional)</span>
                      <input
                        value={project.vercelTeamId}
                        onChange={(event) =>
                          updateProject(project.id, { vercelTeamId: event.target.value })
                        }
                        className="w-full rounded-md border border-[#2a2a3c] bg-[#0d0d14] px-3 py-2 text-sm text-gray-200 focus:border-[#3f3f6a] focus:outline-none"
                        placeholder="team_xxx"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-sm text-gray-300">Framework (optional)</span>
                      <input
                        value={project.vercelFramework}
                        onChange={(event) =>
                          updateProject(project.id, { vercelFramework: event.target.value })
                        }
                        className="w-full rounded-md border border-[#2a2a3c] bg-[#0d0d14] px-3 py-2 text-sm text-gray-200 focus:border-[#3f3f6a] focus:outline-none"
                        placeholder="nextjs"
                      />
                    </label>
                  </>
                )}

                {(project.target === "supabase" || project.target === "both") && (
                  <>
                    <label className="space-y-1">
                      <span className="text-sm text-gray-300">Supabase org ID</span>
                      <input
                        value={project.supabaseOrgId}
                        onChange={(event) =>
                          updateProject(project.id, { supabaseOrgId: event.target.value })
                        }
                        className="w-full rounded-md border border-[#2a2a3c] bg-[#0d0d14] px-3 py-2 text-sm text-gray-200 focus:border-[#3f3f6a] focus:outline-none"
                        placeholder="org_xxx"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-sm text-gray-300">Supabase region</span>
                      <input
                        value={project.supabaseRegion}
                        onChange={(event) =>
                          updateProject(project.id, { supabaseRegion: event.target.value })
                        }
                        className="w-full rounded-md border border-[#2a2a3c] bg-[#0d0d14] px-3 py-2 text-sm text-gray-200 focus:border-[#3f3f6a] focus:outline-none"
                        placeholder="us-east-1"
                      />
                    </label>
                    <label className="space-y-1 md:col-span-2">
                      <span className="text-sm text-gray-300">DB password</span>
                      <input
                        type="password"
                        value={project.supabaseDbPassword}
                        onChange={(event) =>
                          updateProject(project.id, { supabaseDbPassword: event.target.value })
                        }
                        className="w-full rounded-md border border-[#2a2a3c] bg-[#0d0d14] px-3 py-2 text-sm text-gray-200 focus:border-[#3f3f6a] focus:outline-none"
                        placeholder="Strong database password"
                      />
                    </label>
                    <label className="space-y-1 md:col-span-2">
                      <span className="text-sm text-gray-300">Migrations (optional)</span>
                      <textarea
                        value={project.supabaseMigrations}
                        onChange={(event) =>
                          updateProject(project.id, { supabaseMigrations: event.target.value })
                        }
                        className="min-h-28 w-full rounded-md border border-[#2a2a3c] bg-[#0d0d14] px-3 py-2 text-sm text-gray-200 focus:border-[#3f3f6a] focus:outline-none"
                        placeholder={"Paste SQL migration(s). Separate entries with a line containing ---"}
                      />
                    </label>
                  </>
                )}
              </div>

              <div className="mt-4 flex items-center justify-between">
                <button
                  type="submit"
                  disabled={startingProjectID === project.id}
                  className="inline-flex items-center rounded-md bg-[#10b981] px-4 py-2 text-sm font-medium text-[#062117] hover:bg-[#1ac790] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {startingProjectID === project.id ? "Starting..." : "Deploy Project"}
                </button>
                <button
                  type="button"
                  onClick={() => removeProject(project.id)}
                  className="inline-flex items-center rounded-md border border-[#32324a] px-3 py-2 text-sm font-medium text-gray-300 hover:bg-[#181826]"
                >
                  Remove
                </button>
              </div>
            </form>
          ))}
        </section>

        <section className="rounded-xl border border-[#1f1f30] bg-[#11111a] p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
          <h2 className="text-lg font-medium text-gray-100">Deploy log</h2>
          {sortedRuns.length === 0 ? (
            <p className="mt-2 text-sm text-gray-400">No deployment runs yet.</p>
          ) : (
            <div className="mt-3 space-y-3">
              {sortedRuns.map((run) => (
                <div key={run.id} className="rounded-lg border border-[#25253a] bg-[#0d0d14] p-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-sm font-medium text-gray-100">
                      {providerLabel[run.provider]} / {run.target_name}
                    </span>
                    <span className="text-xs text-gray-400">{run.id}</span>
                    <span
                      className={
                        run.status === "succeeded"
                          ? "text-xs text-emerald-300"
                          : run.status === "failed"
                            ? "text-xs text-red-300"
                            : "text-xs text-amber-300"
                      }
                    >
                      {run.status}
                    </span>
                  </div>
                  {run.external_id ? (
                    <p className="mt-1 text-xs text-gray-400">External ID: {run.external_id}</p>
                  ) : null}
                  {run.error ? <p className="mt-1 text-xs text-red-300">{run.error}</p> : null}
                  <div className="mt-2 max-h-40 overflow-y-auto rounded border border-[#202032] bg-[#0a0a11] p-2 font-mono text-xs text-gray-300">
                    {run.logs.length === 0 ? (
                      <p className="text-gray-500">No logs yet...</p>
                    ) : (
                      run.logs.map((log, index) => (
                        <p key={`${run.id}-${index}`}>
                          [{formatDate(log.timestamp)}] {log.message}
                        </p>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
