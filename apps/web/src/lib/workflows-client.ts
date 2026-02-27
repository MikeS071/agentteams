export type WorkflowStep = {
  id: string;
  type: "text" | "choice" | "confirm" | "file_upload";
  prompt: string;
  options?: string[];
  default?: string;
  help?: string;
};

export type WorkflowTemplate = {
  id: string;
  name: string;
  description: string;
  icon?: string;
  costHint?: string;
  stepCount: number;
  estimatedDuration: string;
  steps: WorkflowStep[];
};

export type WorkflowRun = {
  id: string;
  workflow_id: string;
  tenant_id: string;
  current_step: number;
  inputs: Record<string, string>;
  status: string;
};

export type RunSnapshot = {
  run: WorkflowRun;
  next_step: WorkflowStep | null;
};

export type TrackedWorkflowRun = {
  id: string;
  workflowId: string;
  workflowName: string;
  startedAt: string;
  status: string;
  rejected?: boolean;
};

const STORAGE_KEY = "agentteams.workflowRuns";

export function readTrackedRuns(): TrackedWorkflowRun[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TrackedWorkflowRun[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export function writeTrackedRuns(runs: TrackedWorkflowRun[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(runs));
}

export function upsertTrackedRun(run: TrackedWorkflowRun): TrackedWorkflowRun[] {
  const existing = readTrackedRuns();
  const idx = existing.findIndex((item) => item.id === run.id);

  if (idx >= 0) {
    existing[idx] = { ...existing[idx], ...run };
  } else {
    existing.unshift(run);
  }

  const trimmed = existing.slice(0, 40);
  writeTrackedRuns(trimmed);
  return trimmed;
}

export function getRunDisplayStatus(snapshot: RunSnapshot | null, rejected?: boolean): string {
  if (rejected) return "rejected";
  if (!snapshot) return "unknown";
  if (snapshot.run.status === "confirmed") return "confirmed";
  if (!snapshot.next_step) return "awaiting_confirmation";
  return "in_progress";
}
