import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { FEATURES, isFeature, type Feature } from "@/lib/features";

export type TenantPolicySummary = {
  tenantId: string;
  tenantName: string;
  email: string | null;
  features: Record<Feature, boolean>;
};

const FEATURE_VALUES_SQL = FEATURES.map((feature) => `('${feature}')`).join(",");

function defaultFeatureMap(): Record<Feature, boolean> {
  return {
    swarm: true,
    terminal: true,
    deploy: true,
    telegram: true,
    whatsapp: true,
    webchat: true,
    catalog: true,
  };
}

export async function ensureTenantPolicyRows(): Promise<void> {
  await pool.query(
    `INSERT INTO tenant_policies (tenant_id, feature, enabled)
     SELECT t.id, f.feature::feature_policy, TRUE
     FROM tenants t
     CROSS JOIN (VALUES ${FEATURE_VALUES_SQL}) AS f(feature)
     LEFT JOIN tenant_policies tp
       ON tp.tenant_id = t.id
      AND tp.feature = f.feature::feature_policy
     WHERE tp.id IS NULL`
  );
}

export async function getTenantFeatureMap(
  tenantId: string
): Promise<Record<Feature, boolean>> {
  await ensureTenantPolicyRows();

  const result = await pool.query<{ feature: string; enabled: boolean }>(
    `SELECT feature::text AS feature, enabled
     FROM tenant_policies
     WHERE tenant_id = $1`,
    [tenantId]
  );

  const featureMap = defaultFeatureMap();
  for (const row of result.rows) {
    if (isFeature(row.feature)) {
      featureMap[row.feature] = row.enabled;
    }
  }

  return featureMap;
}

export async function checkFeatureAccess(
  tenantId: string,
  feature: Feature
): Promise<NextResponse | null> {
  await ensureTenantPolicyRows();

  const result = await pool.query<{ enabled: boolean }>(
    `SELECT enabled
     FROM tenant_policies
     WHERE tenant_id = $1 AND feature = $2::feature_policy`,
    [tenantId, feature]
  );

  const enabled = result.rows[0]?.enabled ?? true;
  if (enabled) {
    return null;
  }

  return NextResponse.json(
    { error: "Feature not available on your plan" },
    { status: 403 }
  );
}

export async function listTenantPolicies(
  search: string
): Promise<TenantPolicySummary[]> {
  await ensureTenantPolicyRows();

  const term = search.trim();
  const likeTerm = `%${term}%`;

  const result = await pool.query<{
    tenant_id: string;
    tenant_name: string;
    email: string | null;
    feature: string;
    enabled: boolean;
  }>(
    `SELECT
       t.id AS tenant_id,
       COALESCE(NULLIF(TRIM(u.name), ''), u.email, t.id::text) AS tenant_name,
       u.email,
       tp.feature::text AS feature,
       tp.enabled
     FROM tenants t
     JOIN users u ON u.id = t.user_id
     JOIN tenant_policies tp ON tp.tenant_id = t.id
     WHERE ($1 = '' OR u.name ILIKE $2 OR u.email ILIKE $2)
     ORDER BY tenant_name ASC, tp.feature ASC`,
    [term, likeTerm]
  );

  const byTenant = new Map<string, TenantPolicySummary>();
  for (const row of result.rows) {
    const existing = byTenant.get(row.tenant_id);
    const tenant =
      existing ??
      ({
        tenantId: row.tenant_id,
        tenantName: row.tenant_name,
        email: row.email,
        features: defaultFeatureMap(),
      } as TenantPolicySummary);

    if (isFeature(row.feature)) {
      tenant.features[row.feature] = row.enabled;
    }

    byTenant.set(row.tenant_id, tenant);
  }

  return Array.from(byTenant.values());
}

export async function setTenantFeaturePolicy(
  tenantId: string,
  feature: Feature,
  enabled: boolean
): Promise<void> {
  await pool.query(
    `INSERT INTO tenant_policies (tenant_id, feature, enabled, updated_at)
     VALUES ($1, $2::feature_policy, $3, NOW())
     ON CONFLICT (tenant_id, feature)
     DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()`,
    [tenantId, feature, enabled]
  );
}

export async function setFeaturePolicyForAllTenants(
  feature: Feature,
  enabled: boolean
): Promise<void> {
  await ensureTenantPolicyRows();

  await pool.query(
    `UPDATE tenant_policies
     SET enabled = $2, updated_at = NOW()
     WHERE feature = $1::feature_policy`,
    [feature, enabled]
  );
}
