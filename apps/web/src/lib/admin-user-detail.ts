import pool from "@/lib/db";

type UsageRow = {
  date: string;
  total_tokens: string | number;
};

type ChannelRow = {
  id: string;
  channel: string;
  channel_user_id: string;
  muted: boolean;
  linked_at: string;
};

type CreditTransactionRow = {
  id: string;
  amount_cents: number;
  reason: string;
  admin_user_id: string | null;
  admin_email: string | null;
  created_at: string;
};

export type AdminUserDetail = {
  profile: {
    id: string;
    email: string;
    name: string | null;
    tenantId: string | null;
    role: "admin" | "user";
    status: "active" | "suspended";
    signupDate: string;
    lastActive: string | null;
  };
  usage: Array<{ date: string; totalTokens: number }>;
  channels: ChannelRow[];
  container: {
    containerId: string;
    status: string | null;
  } | null;
  credits: {
    balanceCents: number;
    transactions: CreditTransactionRow[];
  };
};

export async function getAdminUserDetail(userId: string): Promise<AdminUserDetail | null> {
  const profileResult = await pool.query<{
    id: string;
    email: string;
    name: string | null;
    is_admin: boolean;
    suspended_at: string | null;
    created_at: string;
    tenant_id: string | null;
    tenant_status: string | null;
    container_id: string | null;
    last_active: string | null;
  }>(
    `SELECT
       u.id,
       u.email,
       u.name,
       u.is_admin,
       u.suspended_at::text,
       u.created_at::text,
       t.id AS tenant_id,
       t.status AS tenant_status,
       t.container_id,
       (
         SELECT MAX(activity.last_seen)::text
         FROM (
           SELECT MAX(ul.created_at) AS last_seen
           FROM usage_logs ul
           WHERE ul.tenant_id = t.id
           UNION ALL
           SELECT MAX(m.created_at) AS last_seen
           FROM conversations c
           JOIN messages m ON m.conversation_id = c.id
           WHERE c.tenant_id = t.id
         ) AS activity
       ) AS last_active
     FROM users u
     LEFT JOIN tenants t ON t.user_id = u.id
     WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [userId]
  );

  const profile = profileResult.rows[0];
  if (!profile) {
    return null;
  }

  const tenantId = profile.tenant_id;

  let usage: UsageRow[] = [];
  let channels: ChannelRow[] = [];
  let creditBalance = 0;
  let transactions: CreditTransactionRow[] = [];

  if (tenantId) {
    const usageResult = await pool.query<UsageRow>(
      `SELECT
         date_series.day::date::text AS date,
         COALESCE(SUM(ul.input_tokens + ul.output_tokens), 0) AS total_tokens
       FROM generate_series(
         CURRENT_DATE - INTERVAL '29 days',
         CURRENT_DATE,
         INTERVAL '1 day'
       ) AS date_series(day)
       LEFT JOIN usage_logs ul
         ON ul.tenant_id = $1
        AND DATE(ul.created_at) = date_series.day::date
       GROUP BY date_series.day
       ORDER BY date_series.day ASC`,
      [tenantId]
    );
    usage = usageResult.rows;

    const channelsResult = await pool.query<ChannelRow>(
      `SELECT id, channel, channel_user_id, muted, linked_at::text
       FROM tenant_channels
       WHERE tenant_id = $1
       ORDER BY linked_at DESC`,
      [tenantId]
    );
    channels = channelsResult.rows;

    const creditResult = await pool.query<{ balance_cents: number }>(
      `SELECT balance_cents
       FROM credits
       WHERE tenant_id = $1`,
      [tenantId]
    );
    creditBalance = creditResult.rows[0]?.balance_cents ?? 0;

    const txResult = await pool.query<CreditTransactionRow>(
      `SELECT
         ct.id,
         ct.amount_cents,
         ct.reason,
         ct.admin_user_id,
         admin.email AS admin_email,
         ct.created_at::text
       FROM credit_transactions ct
       LEFT JOIN users admin ON admin.id = ct.admin_user_id
       WHERE ct.tenant_id = $1
       ORDER BY ct.created_at DESC
       LIMIT 100`,
      [tenantId]
    );
    transactions = txResult.rows;
  }

  return {
    profile: {
      id: profile.id,
      email: profile.email,
      name: profile.name,
      tenantId: profile.tenant_id,
      role: profile.is_admin ? "admin" : "user",
      status: profile.suspended_at ? "suspended" : "active",
      signupDate: profile.created_at,
      lastActive: profile.last_active,
    },
    usage: usage.map((row) => ({ date: row.date, totalTokens: Number(row.total_tokens) })),
    channels,
    container: profile.container_id
      ? {
          containerId: profile.container_id,
          status: profile.tenant_status,
        }
      : null,
    credits: {
      balanceCents: creditBalance,
      transactions,
    },
  };
}
