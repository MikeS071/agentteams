import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const runtime = "nodejs";

type TicketStatus = "done" | "running" | "todo" | "failed" | "blocked";

type TrackerTicket = {
  status?: string;
  phase?: number;
  desc?: string;
  description?: string;
  started_at?: string;
  startedAt?: string;
  updated_at?: string;
  updatedAt?: string;
  elapsed_seconds?: number;
  elapsedSeconds?: number;
  output?: unknown;
};

type TrackerProject = {
  project?: string;
  tickets?: Record<string, TrackerTicket>;
};

type TrackerState = TrackerProject & {
  projects?: Record<string, TrackerProject>;
};

type SwarmTicket = {
  id: string;
  phase: number;
  status: TicketStatus;
  description: string;
  startedAt?: string;
  elapsedSeconds?: number;
  output?: string;
};

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function normalizeStatus(status?: string): TicketStatus {
  const value = (status || "").toLowerCase();
  if (["done", "complete", "completed", "success"].includes(value)) {
    return "done";
  }
  if (["running", "in_progress", "active"].includes(value)) {
    return "running";
  }
  if (["failed", "error"].includes(value)) {
    return "failed";
  }
  if (["blocked", "paused", "waiting"].includes(value)) {
    return "blocked";
  }
  return "todo";
}

function coerceOutput(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

async function loadTrackerState(): Promise<TrackerState> {
  const candidates = [
    path.join(process.cwd(), "swarm", "tracker.json"),
    path.join(process.cwd(), "..", "swarm", "tracker.json"),
    path.join(process.cwd(), "..", "..", "swarm", "tracker.json"),
  ];

  for (const candidate of candidates) {
    try {
      const raw = await readFile(candidate, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as TrackerState;
      }
    } catch {
      // Try the next candidate path.
    }
  }

  throw new Error("Unable to load swarm tracker state.");
}

function pickProject(
  tracker: TrackerState,
  requestedProject?: string
): { project: string; tickets: Record<string, TrackerTicket> } | null {
  const requested = requestedProject?.trim();

  if (tracker.projects && typeof tracker.projects === "object" && !Array.isArray(tracker.projects)) {
    const names = Object.keys(tracker.projects);
    if (names.length === 0) {
      return null;
    }

    const projectName = requested || names[0];
    const selected = tracker.projects[projectName];
    if (!selected) {
      return null;
    }

    return {
      project: projectName,
      tickets: selected.tickets ?? {},
    };
  }

  const rootProject = (tracker.project || "").trim() || "agentsquads";
  if (requested && requested !== rootProject) {
    return null;
  }

  return {
    project: requested || rootProject,
    tickets: tracker.tickets ?? {},
  };
}

function normalizeTickets(rawTickets: Record<string, TrackerTicket>): SwarmTicket[] {
  const now = Date.now();
  return Object.entries(rawTickets)
    .map(([id, ticket]) => {
      const phase = Number.isFinite(ticket.phase) ? Number(ticket.phase) : 1;
      const description = ticket.desc || ticket.description || id;
      const startedAt = (ticket.startedAt || ticket.started_at || "").trim() || undefined;
      const elapsedSecondsRaw = typeof ticket.elapsedSeconds === "number"
        ? ticket.elapsedSeconds
        : typeof ticket.elapsed_seconds === "number"
          ? ticket.elapsed_seconds
          : undefined;

      let elapsedSeconds = elapsedSecondsRaw;
      if (elapsedSeconds === undefined && startedAt) {
        const startedMs = new Date(startedAt).getTime();
        if (!Number.isNaN(startedMs)) {
          elapsedSeconds = Math.max(0, Math.floor((now - startedMs) / 1000));
        }
      }

      return {
        id,
        phase: phase > 0 ? phase : 1,
        status: normalizeStatus(ticket.status),
        description,
        startedAt,
        elapsedSeconds,
        output: coerceOutput(ticket.output),
      };
    })
    .sort((left, right) => {
      if (left.phase !== right.phase) {
        return left.phase - right.phase;
      }
      return left.id.localeCompare(right.id);
    });
}

function computePhase(tickets: SwarmTicket[]): number {
  if (tickets.length === 0) {
    return 1;
  }

  const phases = Array.from(new Set(tickets.map((ticket) => ticket.phase))).sort((a, b) => a - b);
  for (const phase of phases) {
    const inPhase = tickets.filter((ticket) => ticket.phase === phase);
    if (inPhase.some((ticket) => ticket.status !== "done")) {
      return phase;
    }
  }
  return phases[phases.length - 1];
}

function computeStats(tickets: SwarmTicket[]) {
  const done = tickets.filter((ticket) => ticket.status === "done").length;
  const running = tickets.filter((ticket) => ticket.status === "running").length;
  const todo = tickets.filter((ticket) => ticket.status === "todo").length;
  const failed = tickets.filter((ticket) => ticket.status === "failed").length;
  const blocked = tickets.filter((ticket) => ticket.status === "blocked").length;
  const total = tickets.length;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return { done, running, todo, failed, blocked, total, percent };
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    return unauthorized();
  }

  const requestedProject = req.nextUrl.searchParams.get("project") || undefined;

  try {
    const tracker = await loadTrackerState();
    const selected = pickProject(tracker, requestedProject);
    if (!selected) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const tickets = normalizeTickets(selected.tickets);
    const phase = computePhase(tickets);
    const stats = computeStats(tickets);

    return NextResponse.json({
      project: selected.project,
      phase,
      stats,
      tickets,
    });
  } catch (error) {
    console.error("swarm status GET error", error);
    return NextResponse.json({ error: "Failed to load swarm status" }, { status: 500 });
  }
}
