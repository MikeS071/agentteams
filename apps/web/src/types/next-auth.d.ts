import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      tenantId: string;
      role: "user" | "admin" | "disabled";
      impersonatedTenantId?: string | null;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId: string;
    tenantId: string;
    homeTenantId: string;
    role: "user" | "admin" | "disabled";
    impersonatedTenantId?: string | null;
  }
}
