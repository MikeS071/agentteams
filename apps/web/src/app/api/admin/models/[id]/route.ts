import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/lib/adminAuth";
import { assertValidMarkup, softDeleteAdminModel, updateAdminModel } from "@/lib/adminModels";
import { verifyMutationOrigin } from "@/lib/security";
import { parseJSONBody, parseWithSchema } from "@/lib/validation";

const idSchema = z.object({ id: z.string().trim().min(1).max(120) });
const patchSchema = z
  .object({
    markupPct: z.number().min(0).max(500).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((value) => value.markupPct !== undefined || value.enabled !== undefined, {
    message: "At least one field must be provided",
  });

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const originError = verifyMutationOrigin(request);
    if (originError) {
      return originError;
    }

    const parsedParams = parseWithSchema(params, idSchema, "Invalid model id");
    if (!parsedParams.success) {
      return parsedParams.response;
    }

    const admin = await requireAdminSession();
    if (!admin.ok) {
      return NextResponse.json({ error: admin.error }, { status: admin.status });
    }

    const parsedBody = await parseJSONBody(request, patchSchema);
    if (!parsedBody.success) {
      return parsedBody.response;
    }
    const body = parsedBody.data;
    const patch: { markupPct?: number; enabled?: boolean } = {};

    if (body.markupPct !== undefined) {
      assertValidMarkup(body.markupPct);
      patch.markupPct = body.markupPct;
    }

    if (body.enabled !== undefined) {
      patch.enabled = Boolean(body.enabled);
    }

    const model = await updateAdminModel(parsedParams.data.id, patch);
    return NextResponse.json({ model });
  } catch (error) {
    if (error instanceof Error) {
      const status = error.message === "Model not found" ? 404 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    console.error("Admin model PATCH error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const originError = verifyMutationOrigin(request);
    if (originError) {
      return originError;
    }

    const parsedParams = parseWithSchema(params, idSchema, "Invalid model id");
    if (!parsedParams.success) {
      return parsedParams.response;
    }

    const admin = await requireAdminSession();
    if (!admin.ok) {
      return NextResponse.json({ error: admin.error }, { status: admin.status });
    }

    await softDeleteAdminModel(parsedParams.data.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Admin model DELETE error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
