import { compare } from "bcryptjs";
import type { User } from "next-auth";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GitHubProvider from "next-auth/providers/github";
import GoogleProvider from "next-auth/providers/google";
import {
  ensureStripeCustomer,
  ensureTenantCredits,
  ensureTenantRecord,
  normalizeEmail,
  provisionTenantContainer,
} from "./auth-provisioning";
import pool from "./db";

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

type UserFlagsRow = {
  is_admin: boolean;
  onboarding_completed_at: string | null;
};

async function readUserFlags(userId: string): Promise<{
  isAdmin: boolean;
  onboardingCompleted: boolean;
}> {
  const result = await pool.query<UserFlagsRow>(
    "SELECT is_admin, onboarding_completed_at FROM users WHERE id = $1",
    [userId]
  );
  const row = result.rows[0];
  return {
    isAdmin: row?.is_admin ?? false,
    onboardingCompleted: Boolean(row?.onboarding_completed_at),
  };
}

type UserWithTenantId = User & { tenantId?: string };

type UserStatusRow = {
  suspended_at: string | null;
  deleted_at: string | null;
};

type CredentialUserRow = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  password_hash: string | null;
  suspended_at: string | null;
  deleted_at: string | null;
};

async function ensureAuthUserIsActive(userId: string): Promise<boolean> {
  const result = await pool.query<UserStatusRow>(
    "SELECT suspended_at, deleted_at FROM users WHERE id = $1",
    [userId]
  );

  if (result.rows.length === 0) {
    return false;
  }

  const row = result.rows[0];
  return !row.suspended_at && !row.deleted_at;
}

async function upsertOAuthUser(user: User): Promise<string | null> {
  if (!user.email) {
    return null;
  }

  const email = normalizeEmail(user.email);
  if (!email) {
    return null;
  }

  const existing = await pool.query<{
    id: string;
    suspended_at: string | null;
    deleted_at: string | null;
  }>(
    "SELECT id, suspended_at, deleted_at FROM users WHERE email = $1",
    [email]
  );

  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    if (row.suspended_at || row.deleted_at) {
      return null;
    }
    await pool.query(
      "UPDATE users SET name = COALESCE($1, name), image = COALESCE($2, image), email_verified = COALESCE(email_verified, NOW()) WHERE id = $3",
      [user.name ?? null, user.image ?? null, row.id]
    );
    return row.id;
  }

  const inserted = await pool.query<{ id: string }>(
    "INSERT INTO users (email, name, image, email_verified) VALUES ($1, $2, $3, NOW()) RETURNING id",
    [email, user.name ?? null, user.image ?? null]
  );
  return inserted.rows[0].id;
}

async function ensureUserTenantSetup(
  userId: string,
  email?: string | null
): Promise<string> {
  const { tenantId, created } = await ensureTenantRecord(userId);
  await ensureTenantCredits(tenantId);

  if (email) {
    await ensureStripeCustomer(userId, email);
  }

  if (created) {
    await provisionTenantContainer(tenantId);
  }

  return tenantId;
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
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }),
    CredentialsProvider({
      name: "Email and Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const rawEmail = credentials?.email;
        const rawPassword = credentials?.password;

        if (typeof rawEmail !== "string" || typeof rawPassword !== "string") {
          return null;
        }

        const email = normalizeEmail(rawEmail);
        if (!email || rawPassword.length < 8) {
          return null;
        }

        const result = await pool.query<CredentialUserRow>(
          `SELECT id, email, name, image, password_hash, suspended_at, deleted_at
           FROM users
           WHERE email = $1`,
          [email]
        );

        const row = result.rows[0];
        if (!row || row.suspended_at || row.deleted_at || !row.password_hash) {
          return null;
        }

        const isValidPassword = await compare(rawPassword, row.password_hash);
        if (!isValidPassword) {
          return null;
        }

        return {
          id: row.id,
          email: row.email,
          name: row.name,
          image: row.image,
        };
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (!user.email) return false;

      if (account && account.type === "oauth") {
        const userId = await upsertOAuthUser(user);
        if (!userId) {
          return false;
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

      if (!user.id) {
        return false;
      }

      const isActive = await ensureAuthUserIsActive(user.id);
      if (!isActive) {
        return false;
      }

      const tenantId = await ensureUserTenantSetup(user.id, user.email);
      (user as UserWithTenantId).tenantId = tenantId;

      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        const enrichedUser = user as UserWithTenantId;
        token.tenantId =
          enrichedUser.tenantId ??
          (await ensureUserTenantSetup(user.id, user.email));
      } else if (token.userId && !token.tenantId) {
        token.tenantId = await ensureUserTenantSetup(token.userId);
      }

      if (token.userId) {
        const flags = await readUserFlags(token.userId);
        token.isAdmin = flags.isAdmin;
        token.onboardingCompleted = flags.onboardingCompleted;
      } else {
        token.isAdmin = false;
        token.onboardingCompleted = false;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as Record<string, unknown>).id = token.userId;
        (session.user as Record<string, unknown>).tenantId = token.tenantId;
        (session.user as Record<string, unknown>).isAdmin =
          token.isAdmin ?? false;
        (session.user as Record<string, unknown>).onboardingCompleted =
          token.onboardingCompleted ?? false;
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
