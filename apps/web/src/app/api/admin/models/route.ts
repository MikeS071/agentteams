import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import {
  assertValidCost,
  assertValidMarkup,
  createAdminModel,
  listAdminModels,
} from "@/lib/adminModels";

export const dynamic = "force-dynamic";

type CreateModelBody = {
  name?: unknown;
  provider?: unknown;
  providerCostPer1k?: unknown;
  markupPct?: unknown;
};

export async function GET() {
  try {
    const admin = await requireAdminSession();
    if (!admin.ok) {
      return NextResponse.json({ error: admin.error }, { status: admin.status });
    }

    const models = await listAdminModels();
    return NextResponse.json({ models });
  } catch (error) {
    console.error("Admin models GET error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdminSession();
    if (!admin.ok) {
      return NextResponse.json({ error: admin.error }, { status: admin.status });
    }

    const body = (await request.json()) as CreateModelBody;
    const name = typeof body.name === "string" ? body.name : "";
    const provider = typeof body.provider === "string" ? body.provider : "";
    const providerCostPer1k = Number(body.providerCostPer1k);
    const markupPct = Number(body.markupPct);

    assertValidCost(providerCostPer1k);
    assertValidMarkup(markupPct);

    if (!name.trim() || !provider.trim()) {
      return NextResponse.json(
        { error: "Name and provider are required" },
        { status: 400 }
      );
    }

    const model = await createAdminModel({
      name,
      provider,
      providerCostPer1k,
      markupPct,
    });

    return NextResponse.json({ model }, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Admin models POST error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
