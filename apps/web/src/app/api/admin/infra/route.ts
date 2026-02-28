import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { applyMockInfraAction, getMockInfraPayload } from "@/lib/admin-mock";

export const dynamic = "force-dynamic";

type InfraActionBody = {
  action?: "restart" | "stop";
  containerId?: string;
};

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    return NextResponse.json(getMockInfraPayload());
  } catch (error) {
    console.error("Admin infra GET error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    let body: InfraActionBody;
    try {
      body = (await req.json()) as InfraActionBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }

    const action = body.action;
    const containerId = body.containerId;

    if (!action || !containerId || !["restart", "stop"].includes(action)) {
      return NextResponse.json(
        { error: "action must be restart or stop, and containerId is required" },
        { status: 400 }
      );
    }

    const container = applyMockInfraAction(action, containerId);
    if (!container) {
      return NextResponse.json({ error: "Container not found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      container,
      message: action === "restart" ? "Container restarted" : "Container stopped",
      snapshot: getMockInfraPayload(),
    });
  } catch (error) {
    console.error("Admin infra POST error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
