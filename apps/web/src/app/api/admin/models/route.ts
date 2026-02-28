import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/lib/adminAuth";
import {
  assertValidCost,
  assertValidMarkup,
  createAdminModel,
  listAdminModels,
} from "@/lib/adminModels";
import { verifyMutationOrigin } from "@/lib/security";
import { parseJSONBody } from "@/lib/validation";

export const dynamic = "force-dynamic";

const createModelSchema = z.object({
  name: z.string().trim().min(1).max(120),
  provider: z.string().trim().min(1).max(60),
  providerCostPer1k: z.number().positive(),
  markupPct: z.number().min(0).max(500),
});

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
    const originError = verifyMutationOrigin(request);
    if (originError) {
      return originError;
    }

    const admin = await requireAdminSession();
    if (!admin.ok) {
      return NextResponse.json({ error: admin.error }, { status: admin.status });
    }

    const parsed = await parseJSONBody(request, createModelSchema);
    if (!parsed.success) {
      return parsed.response;
    }
    const { name, provider, providerCostPer1k, markupPct } = parsed.data;

    assertValidCost(providerCostPer1k);
    assertValidMarkup(markupPct);

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
