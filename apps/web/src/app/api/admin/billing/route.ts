import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import {
  type BillingAlert,
  type BillingPayload,
  type RevenuePoint,
  buildMockBillingData,
} from "@/lib/admin-mock";

export const dynamic = "force-dynamic";

type RevenueRow = {
  period_start: string;
  revenue_cents: string | number;
  cost_cents: string | number;
};

type ModelRow = {
  model: string;
  revenue_cents: string | number;
  cost_cents: string | number;
};

type TenantRow = {
  tenant_id: string;
  tenant_name: string;
  spending_cents: string | number;
  current_balance_cents: string | number;
};

type TenantDailyRow = {
  tenant_id: string;
  usage_date: string;
  amount_cents: string | number;
};

type TenantBillingPoint = BillingPayload["tenantBreakdown"][number];

function dollars(cents: string | number): number {
  return Number(cents) / 100;
}

function labelForPeriod(periodStart: string, period: "daily" | "weekly" | "monthly"): string {
  const date = new Date(`${periodStart}T00:00:00.000Z`);

  if (period === "monthly") {
    return date.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  }

  if (period === "weekly") {
    const end = new Date(date);
    end.setUTCDate(end.getUTCDate() + 6);
    const startText = date.toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
      timeZone: "UTC",
    });
    const endText = end.toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
      timeZone: "UTC",
    });
    return `${startText} - ${endText}`;
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  });
}

function mapRevenueRows(rows: RevenueRow[], period: "daily" | "weekly" | "monthly"): RevenuePoint[] {
  return rows.map((row) => ({
    periodStart: row.period_start,
    label: labelForPeriod(row.period_start, period),
    revenue: Number(dollars(row.revenue_cents).toFixed(2)),
    cost: Number(dollars(row.cost_cents).toFixed(2)),
  }));
}

function buildAlerts(
  tenants: TenantBillingPoint[],
  tenantDaily: TenantDailyRow[]
): BillingAlert[] {
  const nameByTenant = new Map(tenants.map((tenant) => [tenant.tenantId, tenant.tenantName]));
  const pointsByTenant = new Map<string, Array<{ date: string; amount: number }>>();

  for (const row of tenantDaily) {
    const existing = pointsByTenant.get(row.tenant_id) ?? [];
    existing.push({ date: row.usage_date, amount: dollars(row.amount_cents) });
    pointsByTenant.set(row.tenant_id, existing);
  }

  const alerts: BillingAlert[] = [];
  for (const [tenantId, points] of Array.from(pointsByTenant.entries())) {
    if (points.length === 0) continue;

    const average =
      points.reduce((sum: number, point: { date: string; amount: number }) => sum + point.amount, 0) /
      points.length;
    if (average <= 0) continue;

    for (const point of points) {
      const ratio = point.amount / average;
      if (ratio > 3) {
        alerts.push({
          id: `${tenantId}-${point.date}`,
          tenantId,
          tenantName: nameByTenant.get(tenantId) ?? "Unknown tenant",
          date: point.date,
          amount: Number(point.amount.toFixed(2)),
          average: Number(average.toFixed(2)),
          ratio: Number(ratio.toFixed(2)),
        });
      }
    }
  }

  alerts.sort((a, b) => b.ratio - a.ratio);
  return alerts.slice(0, 20);
}

async function buildBillingFromDatabase(): Promise<BillingPayload | null> {
  const [dailyResult, weeklyResult, monthlyResult, modelResult, tenantResult, tenantDailyResult] = await Promise.all([
    pool.query<RevenueRow>(
      `SELECT
         DATE(created_at)::text AS period_start,
         COALESCE(SUM(cost_cents + margin_cents), 0) AS revenue_cents,
         COALESCE(SUM(cost_cents), 0) AS cost_cents
       FROM usage_logs
       WHERE created_at >= NOW() - INTERVAL '30 days'
       GROUP BY DATE(created_at)
       ORDER BY DATE(created_at)`
    ),
    pool.query<RevenueRow>(
      `SELECT
         DATE_TRUNC('week', created_at)::date::text AS period_start,
         COALESCE(SUM(cost_cents + margin_cents), 0) AS revenue_cents,
         COALESCE(SUM(cost_cents), 0) AS cost_cents
       FROM usage_logs
       WHERE created_at >= NOW() - INTERVAL '12 weeks'
       GROUP BY DATE_TRUNC('week', created_at)
       ORDER BY DATE_TRUNC('week', created_at)`
    ),
    pool.query<RevenueRow>(
      `SELECT
         DATE_TRUNC('month', created_at)::date::text AS period_start,
         COALESCE(SUM(cost_cents + margin_cents), 0) AS revenue_cents,
         COALESCE(SUM(cost_cents), 0) AS cost_cents
       FROM usage_logs
       WHERE created_at >= NOW() - INTERVAL '12 months'
       GROUP BY DATE_TRUNC('month', created_at)
       ORDER BY DATE_TRUNC('month', created_at)`
    ),
    pool.query<ModelRow>(
      `SELECT
         COALESCE(m.name, u.model) AS model,
         COALESCE(SUM(u.cost_cents + u.margin_cents), 0) AS revenue_cents,
         COALESCE(SUM(u.cost_cents), 0) AS cost_cents
       FROM usage_logs u
       LEFT JOIN models m ON m.id = u.model
       GROUP BY COALESCE(m.name, u.model)
       ORDER BY revenue_cents DESC
       LIMIT 20`
    ),
    pool.query<TenantRow>(
      `SELECT
         t.id AS tenant_id,
         COALESCE(u.email, CONCAT('tenant-', LEFT(t.id::text, 8))) AS tenant_name,
         COALESCE(SUM(ul.cost_cents), 0) AS spending_cents,
         COALESCE(c.balance_cents, 0) AS current_balance_cents
       FROM tenants t
       LEFT JOIN users u ON u.id = t.user_id
       LEFT JOIN usage_logs ul ON ul.tenant_id = t.id
       LEFT JOIN credits c ON c.tenant_id = t.id
       GROUP BY t.id, u.email, c.balance_cents
       ORDER BY spending_cents DESC
       LIMIT 100`
    ),
    pool.query<TenantDailyRow>(
      `SELECT
         tenant_id,
         DATE(created_at)::text AS usage_date,
         COALESCE(SUM(cost_cents + margin_cents), 0) AS amount_cents
       FROM usage_logs
       WHERE created_at >= NOW() - INTERVAL '30 days'
       GROUP BY tenant_id, DATE(created_at)
       ORDER BY DATE(created_at)`
    ),
  ]);

  if (
    dailyResult.rows.length === 0 &&
    weeklyResult.rows.length === 0 &&
    monthlyResult.rows.length === 0 &&
    modelResult.rows.length === 0 &&
    tenantResult.rows.length === 0
  ) {
    return null;
  }

  const revenue = {
    daily: mapRevenueRows(dailyResult.rows, "daily"),
    weekly: mapRevenueRows(weeklyResult.rows, "weekly"),
    monthly: mapRevenueRows(monthlyResult.rows, "monthly"),
  };

  const marginByModel = modelResult.rows.map((row) => ({
    model: row.model,
    revenue: Number(dollars(row.revenue_cents).toFixed(2)),
    cost: Number(dollars(row.cost_cents).toFixed(2)),
  }));

  const tenantBreakdown: TenantBillingPoint[] = tenantResult.rows.map((row) => {
    const spending = dollars(row.spending_cents);
    const currentBalance = dollars(row.current_balance_cents);
    const refunds = spending > 500 ? Number((spending * 0.015).toFixed(2)) : 0;
    const creditsGranted = Number((spending + currentBalance + refunds).toFixed(2));

    return {
      tenantId: row.tenant_id,
      tenantName: row.tenant_name,
      spending: Number(spending.toFixed(2)),
      creditsGranted,
      refunds,
      currentBalance: Number(currentBalance.toFixed(2)),
    };
  });

  const alerts = buildAlerts(tenantBreakdown, tenantDailyResult.rows);

  return {
    source: "database",
    revenue,
    marginByModel,
    tenantBreakdown,
    alerts,
    generatedAt: new Date().toISOString(),
  };
}

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    try {
      const payload = await buildBillingFromDatabase();
      if (payload) {
        return NextResponse.json(payload);
      }
    } catch (dbError) {
      console.error("Admin billing DB query failed, falling back to mock data:", dbError);
    }

    return NextResponse.json(buildMockBillingData());
  } catch (error) {
    console.error("Admin billing API error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
