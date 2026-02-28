import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";

type AdminSession = {
  user: {
    id: string;
    isAdmin?: boolean;
  };
};

export async function requireAdminApiSession(): Promise<
  { session: AdminSession } | { response: NextResponse }
> {
  const session = (await getServerSession(authOptions)) as AdminSession | null;

  if (!session?.user?.id) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (!session.user.isAdmin) {
    return {
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { session };
}
