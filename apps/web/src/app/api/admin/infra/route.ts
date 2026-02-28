import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { applyMockInfraAction, getMockInfraPayload } from "@/lib/admin-mock";
import { verifyMutationOrigin } from "@/lib/security";
import { parseJSONBody } from "@/lib/validation";

export const dynamic = "force-dynamic";

const infraActionSchema = z.object({
  action: z.enum(["restart", "stop"]),
  containerId: z.string().trim().min(1),
});

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
    const originError = verifyMutationOrigin(req);
    if (originError) {
      return originError;
    }

    const auth = await requireAdmin();
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const parsed = await parseJSONBody(req, infraActionSchema);
    if (!parsed.success) {
      return parsed.response;
    }

    const { action, containerId } = parsed.data;

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
