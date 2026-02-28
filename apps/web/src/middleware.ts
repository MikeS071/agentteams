import { withAuth } from "next-auth/middleware";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { checkRateLimit, getClientIP, rateLimitExceededResponse } from "@/lib/rate-limit";

function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/landing.html" ||
    pathname.startsWith("/images/") ||
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/webhooks") ||
    pathname.startsWith("/_next/static") ||
    pathname.startsWith("/_next/image") ||
    pathname === "/favicon.ico"
  );
}

function applyRateLimit(request: NextRequest, userId?: string | null): NextResponse | null {
  const pathname = request.nextUrl.pathname;
  const method = request.method.toUpperCase();

  if (pathname.startsWith("/api/webhooks")) {
    const ip = getClientIP(request);
    const result = checkRateLimit("webhook-ip", ip, 100, 60_000);
    if (!result.ok) {
      return rateLimitExceededResponse(result);
    }
    return null;
  }

  if (pathname.startsWith("/api/auth") && method === "POST") {
    const ip = getClientIP(request);
    const result = checkRateLimit("auth-ip", ip, 5, 60_000);
    if (!result.ok) {
      return rateLimitExceededResponse(result);
    }
    return null;
  }

  if (pathname.startsWith("/api/")) {
    const key = userId?.trim() || `ip:${getClientIP(request)}`;
    const result = checkRateLimit("api-user", key, 60, 60_000);
    if (!result.ok) {
      return rateLimitExceededResponse(result);
    }
  }

  return null;
}

export default withAuth(
  function middleware(request) {
    const userId =
      typeof request.nextauth.token?.userId === "string"
        ? request.nextauth.token.userId
        : request.nextauth.token?.sub;

    const limited = applyRateLimit(request, userId);
    if (limited) {
      return limited;
    }

    return NextResponse.next();
  },
  {
    pages: { signIn: "/login" },
    callbacks: {
      authorized: ({ req, token }) => {
        if (isPublicPath(req.nextUrl.pathname)) {
          return true;
        }
        return !!token;
      },
    },
  }
);

export const config = {
  matcher: [
    "/((?!landing\.html|images/|_next/static|_next/image|favicon\.ico).*)",
  ],
};
