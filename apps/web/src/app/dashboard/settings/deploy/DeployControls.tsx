"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type StepState = {
  status?: string;
  message?: string;
  updated_at?: string;
};

type DeploymentStatus = {
  tenant_id?: string;
  status?: string;
  current_step?: string;
  steps?: Record<string, StepState>;
  vercel_deployment_url?: string;
  vercel_project_url?: string;
  supabase_project_url?: string;
  custom_domain?: string;
  custom_domain_verified?: boolean;
  last_error?: string;
};

type DeployControlsProps = {
  tenantId: string;
  canDeploy: boolean;
  initialStatus: DeploymentStatus | null;
};

const orderedSteps = [
  { key: "read_tokens", label: "Read tokens" },
  { key: "create_supabase_project", label: "Create Supabase project" },
  { key: "run_db_migrations", label: "Run DB migrations" },
  { key: "deploy_vercel", label: "Deploy to Vercel" },
  { key: "configure_custom_domain", label: "Configure custom domain" },
  { key: "store_metadata", label: "Store metadata" },
] as const;

function statusBadge(status: string | undefined): string {
  if (status === "succeeded") return "text-emerald-300";
  if (status === "failed") return "text-red-300";
  if (status === "running") return "text-amber-300";
  return "text-gray-400";
}

export default function DeployControls({ tenantId, canDeploy, initialStatus }: DeployControlsProps) {
  const [status, setStatus] = useState<DeploymentStatus | null>(initialStatus);
  const [isStarting, setIsStarting] = useState(false);
  const [customDomain, setCustomDomain] = useState(initialStatus?.custom_domain ?? "");
  const [actionError, setActionError] = useState<string | null>(null);

  const deploymentStatus = status?.status ?? "idle";
  const isRunning = deploymentStatus === "running";

  const fetchStatus = useCallback(async () => {
    const response = await fetch(`/api/deploy/status/${encodeURIComponent(tenantId)}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      if (response.status === 404) {
        setStatus(null);
        return;
      }
      throw new Error(`Status request failed: ${response.status}`);
    }

    const payload = (await response.json()) as DeploymentStatus;
    setStatus(payload);
  }, [tenantId]);

  useEffect(() => {
    if (!isRunning) {
      return;
    }

    const timer = window.setInterval(() => {
      fetchStatus().catch((error) => {
        console.error("Failed to poll deploy status", error);
      });
    }, 2500);

    return () => window.clearInterval(timer);
  }, [fetchStatus, isRunning]);

  const derivedError = useMemo(() => {
    if (actionError) return actionError;
    if (status?.status === "failed") {
      return status.last_error ?? "Deployment failed";
    }
    return null;
  }, [actionError, status]);

  async function startDeploy() {
    setActionError(null);
    setIsStarting(true);

    try {
      const response = await fetch("/api/deploy/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customDomain }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? `Start failed (${response.status})`);
      }

      await fetchStatus();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to start deployment");
    } finally {
      setIsStarting(false);
    }
  }

  return (
    <section className="rounded-xl border border-[#1f1f30] bg-[#11111a] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-medium text-gray-100">Automated Deployment</h2>
          <p className="mt-1 text-sm text-gray-400">
            Provision Supabase + Vercel and track deployment progress.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <input
            type="text"
            value={customDomain}
            onChange={(event) => setCustomDomain(event.target.value)}
            placeholder="Custom domain (optional), e.g. app.example.com"
            className="rounded-md border border-[#2a2a3c] bg-[#0f0f17] px-3 py-2 text-sm text-gray-100 placeholder:text-gray-500"
            disabled={isRunning || isStarting || !canDeploy}
          />
          <button
            type="button"
            onClick={startDeploy}
            disabled={!canDeploy || isStarting || isRunning}
            className="inline-flex items-center justify-center rounded-md bg-[#6c5ce7] px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isStarting ? "Starting..." : isRunning ? "Deploying..." : "Deploy"}
          </button>
        </div>

        {!canDeploy ? (
          <p className="text-xs text-amber-300">Connect both Vercel and Supabase to enable deployment.</p>
        ) : null}

        {derivedError ? <p className="text-sm text-red-300">{derivedError}</p> : null}

        <div className="rounded-lg border border-[#242438] bg-[#0d0d14] p-4">
          <div className="mb-3 text-sm text-gray-300">
            Status: <span className={statusBadge(deploymentStatus)}>{deploymentStatus}</span>
          </div>

          <div className="space-y-2">
            {orderedSteps.map((step) => {
              const stepState = status?.steps?.[step.key];
              const state = stepState?.status ?? (status?.current_step === step.key ? "running" : "pending");
              return (
                <div key={step.key} className="flex items-start justify-between gap-3 text-sm">
                  <span className="text-gray-200">{step.label}</span>
                  <span className={statusBadge(state)}>{state}</span>
                </div>
              );
            })}
          </div>
        </div>

        {deploymentStatus === "succeeded" ? (
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-200">
            <p className="font-medium">Deployment complete.</p>
            {status?.vercel_deployment_url ? (
              <p className="mt-1 break-all">Vercel URL: {status.vercel_deployment_url}</p>
            ) : null}
            {status?.supabase_project_url ? (
              <p className="mt-1 break-all">Supabase URL: {status.supabase_project_url}</p>
            ) : null}
            {status?.custom_domain ? (
              <p className="mt-1 break-all">
                Domain: {status.custom_domain}
                {status.custom_domain_verified ? " (verified)" : ""}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
