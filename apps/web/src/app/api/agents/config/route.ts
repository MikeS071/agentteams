import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getHandConfig, loadHandConfigs } from "@/lib/hand-configs";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return unauthorized();
  }

  const url = new URL(req.url);
  const agentId = url.searchParams.get("agentId")?.trim();

  if (agentId) {
    const config = await getHandConfig(agentId);
    if (!config) {
      return NextResponse.json({ error: "Agent config not found" }, { status: 404 });
    }
    return NextResponse.json({ config });
  }

  const configs = await loadHandConfigs();
  return NextResponse.json({ configs });
}
