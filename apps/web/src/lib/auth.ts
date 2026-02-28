import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import pool from "./db";

const ALLOWED_EMAILS = new Set([
  "michal.szalinski@gmail.com",
]);
import { getStripe } from "./stripe";

async function findOrCreateTenant(
  userId: string,
  email?: string | null
): Promise<string> {
  const existing = await pool.query(
    "SELECT id FROM tenants WHERE user_id = $1",
    [userId]
  );
  if (existing.rows.length > 0) {
    return existing.rows[0].id;
  }

  const tenant = await pool.query(
    "INSERT INTO tenants (user_id, status) VALUES ($1, 'active') RETURNING id",
    [userId]
  );
  const tenantId = tenant.rows[0].id;

  // Free tier signup bonus: store as 1000 cents ($10 equivalent)
  await pool.query(
    "INSERT INTO credits (tenant_id, balance_cents, free_credit_used) VALUES ($1, 1000, false)",
    [tenantId]
  );

  if (email) {
    try {
      const stripe = getStripe();
      const customer = await stripe.customers.create({
        email,
        metadata: { tenantId },
      });
      await pool.query(
        "UPDATE users SET stripe_customer_id = $1 WHERE id = $2",
        [customer.id, userId]
      );
    } catch {
      // Stripe not configured — skip customer creation
    }
  }

  return tenantId;
}

async function linkAccount(account: {
  userId: string;
  type: string;
  provider: string;
  providerAccountId: string;
  refresh_token?: string | null;
  access_token?: string | null;
  expires_at?: number | null;
  token_type?: string | null;
  scope?: string | null;
  id_token?: string | null;
  session_state?: string | null;
}) {
  await pool.query(
    `INSERT INTO accounts (user_id, type, provider, provider_account_id, refresh_token, access_token, expires_at, token_type, scope, id_token, session_state)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (provider, provider_account_id) DO NOTHING`,
    [
      account.userId,
      account.type,
      account.provider,
      account.providerAccountId,
      account.refresh_token ?? null,
      account.access_token ?? null,
      account.expires_at ?? null,
      account.token_type ?? null,
      account.scope ?? null,
      account.id_token ?? null,
      account.session_state ?? null,
    ]
  );
}

async function readIsAdmin(userId: string): Promise<boolean> {
  const result = await pool.query<{ is_admin: boolean }>(
    "SELECT is_admin FROM users WHERE id = $1",
    [userId]
  );
  return result.rows[0]?.is_admin ?? false;
}

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 8,
    updateAge: 60 * 15,
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    
  ],
  callbacks: {
    async signIn({ user, account }) {
        if (!user.email || !ALLOWED_EMAILS.has(user.email)) {
          return false;
        }
      if (!user.email) return false;

      // Upsert user for OAuth providers
      if (account && account.type === "oauth") {
        const existing = await pool.query(
          "SELECT id, suspended_at, deleted_at FROM users WHERE email = $1",
          [user.email]
        );
        let userId: string;
        if (existing.rows.length > 0) {
          if (existing.rows[0].suspended_at || existing.rows[0].deleted_at) {
            return false;
          }
          userId = existing.rows[0].id;
        } else {
          const inserted = await pool.query(
            "INSERT INTO users (email, name, image, email_verified) VALUES ($1, $2, $3, NOW()) RETURNING id",
            [user.email, user.name ?? null, user.image ?? null]
          );
          userId = inserted.rows[0].id;
        }
        user.id = userId;
        await linkAccount({
          userId,
          type: account.type,
          provider: account.provider,
          providerAccountId: account.providerAccountId,
          refresh_token: account.refresh_token,
          access_token: account.access_token,
          expires_at: account.expires_at,
          token_type: account.token_type,
          scope: account.scope,
          id_token: account.id_token,
          session_state: account.session_state as string | undefined,
        });
      }

      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        const tenantId = await findOrCreateTenant(user.id, user.email);
        token.tenantId = tenantId;
      }
      if (token.userId) {
        token.isAdmin = await readIsAdmin(token.userId);
      } else {
        token.isAdmin = false;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as Record<string, unknown>).id = token.userId;
        (session.user as Record<string, unknown>).tenantId = token.tenantId;
        (session.user as Record<string, unknown>).isAdmin =
          token.isAdmin ?? false;
      }
      return session;
    },
  },
  useSecureCookies: process.env.NODE_ENV === "production",
  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Secure-next-auth.session-token"
          : "next-auth.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
