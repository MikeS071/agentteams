import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import pool from "@/lib/db";

type DailyUsageRow = {
  date: string;
  input_tokens: string | number;
  output_tokens: string | number;
  cost_cents: string | number;
};

type ByModelRow = {
  model: string;
  total_tokens: string | number;
  cost_cents: string | number;
};

type ByAgentRow = {
  agent: string;
  message_count: string | number;
};

type CreditTransactionRow = {
  created_at: string;
  amount_cents: string | number;
  reason: string;
};

type UsageTransactionRow = {
  created_at: string;
  amount_cents: string | number;
};

type BillingEvent = {
  date: string;
  type: "grant" | "purchase" | "usage";
  amountCents: number;
  description: string;
};

export const dynamic = "force-dynamic";

function classifyCreditType(reason: string): "grant" | "purchase" {
  const normalized = reason.toLowerCase();
  if (normalized.includes("purchase") || normalized.includes("stripe") || normalized.includes("checkout")) {
    return "purchase";
  }
  return "grant";
}

function toNumber(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const tenantId = session?.user?.tenantId;

    if (!tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [dailyUsageResult, byModelResult, byAgentResult, creditBalanceResult, creditTxResult, usageTxResult] =
      await Promise.all([
        pool.query<DailyUsageRow>(
          `SELECT
             DATE(created_at)::text AS date,
             COALESCE(SUM(input_tokens), 0) AS input_tokens,
             COALESCE(SUM(output_tokens), 0) AS output_tokens,
             COALESCE(SUM(cost_cents), 0) AS cost_cents
           FROM usage_logs
           WHERE tenant_id = $1
             AND created_at > NOW() - INTERVAL '30 days'
           GROUP BY DATE(created_at)
           ORDER BY DATE(created_at) ASC`,
          [tenantId]
        ),
        pool.query<ByModelRow>(
          `SELECT
             COALESCE(m.name, u.model) AS model,
             COALESCE(SUM(u.input_tokens + u.output_tokens), 0) AS total_tokens,
             COALESCE(SUM(u.cost_cents), 0) AS cost_cents
           FROM usage_logs u
           LEFT JOIN models m ON m.id = u.model
           WHERE u.tenant_id = $1
           GROUP BY COALESCE(m.name, u.model)
           ORDER BY cost_cents DESC`,
          [tenantId]
        ),
        pool.query<ByAgentRow>(
          `SELECT
             COALESCE(NULLIF(m.metadata->>'agent_id', ''), 'Unassigned') AS agent,
             COUNT(*) AS message_count
           FROM messages m
           INNER JOIN conversations c ON c.id = m.conversation_id
           WHERE c.tenant_id = $1
             AND m.role = 'user'
           GROUP BY COALESCE(NULLIF(m.metadata->>'agent_id', ''), 'Unassigned')
           ORDER BY message_count DESC
           LIMIT 12`,
          [tenantId]
        ),
        pool.query<{ balance_cents: string | number }>(
          "SELECT balance_cents FROM credits WHERE tenant_id = $1",
          [tenantId]
        ),
        pool.query<CreditTransactionRow>(
          `SELECT created_at::text, amount_cents, reason
           FROM credit_transactions
           WHERE tenant_id = $1
           ORDER BY created_at ASC`,
          [tenantId]
        ),
        pool.query<UsageTransactionRow>(
          `SELECT
             created_at::text,
             cost_cents AS amount_cents
           FROM usage_logs
           WHERE tenant_id = $1
           ORDER BY created_at ASC`,
          [tenantId]
        ),
      ]);

    const daily = dailyUsageResult.rows.map((row) => {
      const inputTokens = toNumber(row.input_tokens);
      const outputTokens = toNumber(row.output_tokens);
      const costCents = toNumber(row.cost_cents);
      return {
        date: row.date,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        costCents,
      };
    });

    const byModel = byModelResult.rows.map((row) => ({
      model: row.model,
      totalTokens: toNumber(row.total_tokens),
      costCents: toNumber(row.cost_cents),
    }));

    const byAgent = byAgentResult.rows.map((row) => ({
      agent: row.agent,
      messageCount: toNumber(row.message_count),
    }));

    const events: BillingEvent[] = [];

    for (const row of creditTxResult.rows) {
      const amountCents = toNumber(row.amount_cents);
      events.push({
        date: row.created_at,
        type: classifyCreditType(row.reason),
        amountCents,
        description: row.reason,
      });
    }

    for (const row of usageTxResult.rows) {
      const amountCents = toNumber(row.amount_cents);
      events.push({
        date: row.created_at,
        type: "usage",
        amountCents: -amountCents,
        description: "Model usage",
      });
    }

    events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const currentBalanceCents = toNumber(creditBalanceResult.rows[0]?.balance_cents ?? 0);
    const netEventsCents = events.reduce((sum, item) => sum + item.amountCents, 0);
    const openingBalanceCents = currentBalanceCents - netEventsCents;

    let runningBalance = openingBalanceCents;
    const transactions = events.map((item) => {
      runningBalance += item.amountCents;
      return {
        date: item.date,
        type: item.type,
        amountCents: item.amountCents,
        balanceAfterCents: runningBalance,
        description: item.description,
      };
    });

    return NextResponse.json({
      daily,
      byModel,
      byAgent,
      transactions: transactions.reverse().slice(0, 120),
    });
  } catch (error) {
    console.error("Billing usage error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
