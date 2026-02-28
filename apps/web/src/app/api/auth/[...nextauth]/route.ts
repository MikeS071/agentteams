import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";
import { verifyMutationOrigin } from "@/lib/security";

const handler = NextAuth(authOptions);

export const GET = handler;

export async function POST(request: Request) {
  const originError = verifyMutationOrigin(request);
  if (originError) {
    return originError;
  }

  return handler(request);
}
