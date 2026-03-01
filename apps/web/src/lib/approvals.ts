export type ApprovalRisk = "low" | "medium" | "high" | "critical" | "unknown";

export type ApprovalItem = {
  handId: string;
  actionId: string;
  handName: string;
  actionDescription: string;
  riskLevel: ApprovalRisk;
  timestamp: string;
  reason?: string;
  tools: string[];
  preview?: string;
  context?: string;
};

export const APPROVALS_STORAGE_KEY = "openfang:pending-approvals-v1";

const APPROVAL_EVENTS = new Set(["approval_required", "approval.pending", "hand.approval_required"]);
const RESOLVED_EVENTS = new Set([
  "approval_resolved",
  "approval_approved",
  "approval_rejected",
  "approval.completed",
  "hand.approval_resolved",
]);

export const AI_AGENT_SSE_EVENT_NAMES = [
  "approval_required",
  "approval.pending",
  "hand.approval_required",
  "approval_resolved",
  "approval_approved",
  "approval_rejected",
  "approval.completed",
  "hand.approval_resolved",
];

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asArrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeRisk(value: unknown): ApprovalRisk {
  const raw = asString(value)?.toLowerCase();
  if (raw === "low" || raw === "medium" || raw === "high" || raw === "critical") {
    return raw;
  }
  return "unknown";
}

function toISOTime(value: unknown): string {
  const raw = asString(value);
  if (!raw) {
    return new Date().toISOString();
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

function firstString(data: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const found = asString(data[key]);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function extractPayload(raw: unknown): Record<string, unknown> | null {
  const base = asRecord(raw);
  if (!base) {
    return null;
  }

  const nested = asRecord(base.payload) ?? asRecord(base.data);
  return nested ?? base;
}

export function parseApprovalEvent(rawData: string): { type: "required"; item: ApprovalItem } | { type: "resolved"; handId: string; actionId: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawData) as unknown;
  } catch {
    return null;
  }

  const envelope = asRecord(parsed);
  if (!envelope) {
    return null;
  }

  const eventType = firstString(envelope, ["type", "event", "name"]);
  const payload = extractPayload(envelope);
  if (!eventType || !payload) {
    return null;
  }

  const handId = firstString(payload, ["hand_id", "handId", "id"]);
  const actionId = firstString(payload, ["action_id", "actionId", "approval_id", "approvalId"]);
  if (!handId || !actionId) {
    return null;
  }

  if (APPROVAL_EVENTS.has(eventType)) {
    const handName = firstString(payload, ["hand_name", "handName", "name"]) ?? `Hand ${handId}`;
    const actionDescription =
      firstString(payload, ["action_description", "actionDescription", "action", "description"]) ??
      "Sensitive action pending approval";
    const reason = firstString(payload, ["why", "reason", "justification"]);
    const preview = firstString(payload, ["preview", "action_preview", "actionPreview"]);
    const context = firstString(payload, ["context", "full_context", "fullContext"]);
    const tools = asArrayOfStrings(payload.tools ?? payload.tool_names ?? payload.toolNames);

    return {
      type: "required",
      item: {
        handId,
        actionId,
        handName,
        actionDescription,
        riskLevel: normalizeRisk(payload.risk_level ?? payload.riskLevel ?? payload.risk),
        timestamp: toISOTime(payload.timestamp ?? payload.created_at ?? payload.createdAt ?? payload.time),
        reason,
        tools,
        preview,
        context,
      },
    };
  }

  if (RESOLVED_EVENTS.has(eventType)) {
    return {
      type: "resolved",
      handId,
      actionId,
    };
  }

  return null;
}

export function upsertApprovalItem(list: ApprovalItem[], item: ApprovalItem): ApprovalItem[] {
  const existingIndex = list.findIndex((entry) => entry.handId === item.handId && entry.actionId === item.actionId);
  if (existingIndex === -1) {
    return [item, ...list].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  }

  const next = [...list];
  next[existingIndex] = item;
  return next.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

export function removeApprovalItem(list: ApprovalItem[], handId: string, actionId: string): ApprovalItem[] {
  return list.filter((entry) => !(entry.handId === handId && entry.actionId === actionId));
}

export function formatApprovalTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function hydrateApprovalsFromStorage(): ApprovalItem[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(APPROVALS_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((item): item is ApprovalItem => {
        if (!item || typeof item !== "object") {
          return false;
        }
        const candidate = item as Partial<ApprovalItem>;
        return Boolean(candidate.handId && candidate.actionId && candidate.handName && candidate.actionDescription && candidate.timestamp);
      })
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  } catch {
    return [];
  }
}

export function persistApprovalsToStorage(items: ApprovalItem[]) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(APPROVALS_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Ignore storage write failures.
  }
}
