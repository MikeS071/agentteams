import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

type StartBody = {
  templateName?: string;
  template?: string;
};

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: StartBody;
  try {
    body = (await req.json()) as StartBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const templateName = body.templateName?.trim() ?? body.template?.trim() ?? "";
  if (!templateName) {
    return NextResponse.json({ error: "templateName is required" }, { status: 400 });
  }

  const apiBaseURL = process.env.API_URL ?? "http://localhost:8080";

  try {
    const upstream = await fetch(`${apiBaseURL}/api/workflows/${encodeURIComponent(templateName)}/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tenant_id: session.user.tenantId }),
    });

    const payload = await upstream.json();
    if (!upstream.ok) {
      return NextResponse.json(payload, { status: upstream.status });
    }

    return NextResponse.json(payload, { status: 201 });
  } catch (error) {
    console.error("Workflow start error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
