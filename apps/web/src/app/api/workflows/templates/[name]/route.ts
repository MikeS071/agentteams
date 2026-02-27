import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function apiBaseURL() {
  return process.env.API_URL ?? "http://localhost:8080";
}

type RouteContext = {
  params: {
    name: string;
  };
};

export async function GET(_: Request, context: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return unauthorized();
  }

  const name = context.params.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "Template name is required" }, { status: 400 });
  }

  try {
    const response = await fetch(`${apiBaseURL()}/api/workflows/templates/${encodeURIComponent(name)}`, {
      cache: "no-store",
    });
    const text = await response.text();
    return new NextResponse(text, {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("template detail proxy failed", error);
    return NextResponse.json({ error: "Failed to fetch template" }, { status: 500 });
  }
}
