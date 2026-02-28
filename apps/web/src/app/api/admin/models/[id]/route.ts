import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { assertValidMarkup, softDeleteAdminModel, updateAdminModel } from "@/lib/adminModels";

type PatchBody = {
  markupPct?: unknown;
  enabled?: unknown;
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await requireAdminSession();
    if (!admin.ok) {
      return NextResponse.json({ error: admin.error }, { status: admin.status });
    }

    const body = (await request.json()) as PatchBody;
    const patch: { markupPct?: number; enabled?: boolean } = {};

    if (body.markupPct !== undefined) {
      const markupPct = Number(body.markupPct);
      assertValidMarkup(markupPct);
      patch.markupPct = markupPct;
    }

    if (body.enabled !== undefined) {
      patch.enabled = Boolean(body.enabled);
    }

    const model = await updateAdminModel(params.id, patch);
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
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await requireAdminSession();
    if (!admin.ok) {
      return NextResponse.json({ error: admin.error }, { status: admin.status });
    }

    await softDeleteAdminModel(params.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Admin model DELETE error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
