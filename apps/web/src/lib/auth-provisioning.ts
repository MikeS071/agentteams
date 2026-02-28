import pool from "./db";
import { buildServiceHeaders } from "./security";
import { getStripe } from "./stripe";

const DEFAULT_API_URL = "http://localhost:8080";

type TenantRow = {
  id: string;
  container_id: string | null;
};

type UserStripeRow = {
  stripe_customer_id: string | null;
};

type ProvisionResponse = {
  containerId?: string;
  container_id?: string;
  id?: string;
  status?: string;
};

function getApiBaseURL(): string {
  const apiURL = process.env.API_URL?.trim();
  return apiURL && apiURL.length > 0 ? apiURL : DEFAULT_API_URL;
}

function parseContainerId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const data = payload as ProvisionResponse;
  const candidate = data.containerId ?? data.container_id ?? data.id ?? null;
  if (typeof candidate === "string" && candidate.trim().length > 0) {
    return candidate;
  }
  return null;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function ensureTenantRecord(
  userId: string
): Promise<{ tenantId: string; created: boolean; containerId: string | null }> {
  const existing = await pool.query<TenantRow>(
    "SELECT id, container_id FROM tenants WHERE user_id = $1",
    [userId]
  );

  if (existing.rows.length > 0) {
    const tenant = existing.rows[0];
    return {
      tenantId: tenant.id,
      created: false,
      containerId: tenant.container_id,
    };
  }

  const inserted = await pool.query<TenantRow>(
    "INSERT INTO tenants (user_id, status) VALUES ($1, 'active') RETURNING id, container_id",
    [userId]
  );

  const tenant = inserted.rows[0];
  return {
    tenantId: tenant.id,
    created: true,
    containerId: tenant.container_id,
  };
}

export async function ensureTenantCredits(tenantId: string): Promise<void> {
  await pool.query(
    `INSERT INTO credits (tenant_id, balance_cents, free_credit_used)
     VALUES ($1, 1000, false)
     ON CONFLICT (tenant_id) DO NOTHING`,
    [tenantId]
  );
}

export async function ensureStripeCustomer(
  userId: string,
  email: string
): Promise<void> {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return;
  }

  const result = await pool.query<UserStripeRow>(
    "SELECT stripe_customer_id FROM users WHERE id = $1",
    [userId]
  );
  if (result.rows[0]?.stripe_customer_id) {
    return;
  }

  try {
    const stripe = getStripe();
    const customer = await stripe.customers.create({
      email: normalizedEmail,
    });
    await pool.query(
      "UPDATE users SET stripe_customer_id = $1 WHERE id = $2",
      [customer.id, userId]
    );
  } catch (error) {
    console.warn("Stripe customer setup skipped:", error);
  }
}

export async function provisionTenantContainer(tenantId: string): Promise<void> {
  let serviceHeaders: Record<string, string>;
  try {
    serviceHeaders = buildServiceHeaders();
  } catch (error) {
    console.warn("Tenant provisioning skipped (service key missing):", error);
    return;
  }

  const apiBaseURL = getApiBaseURL();
  const endpoints = [
    `/api/tenants/${tenantId}/start`,
    `/api/tenants/${tenantId}/resume`,
  ];

  let response: Response | null = null;
  let lastPath = endpoints[0];

  for (const path of endpoints) {
    lastPath = path;
    response = await fetch(`${apiBaseURL}${path}`, {
      method: "POST",
      cache: "no-store",
      headers: {
        ...serviceHeaders,
      },
    });

    if (response.status === 404 && path.endsWith("/start")) {
      continue;
    }
    break;
  }

  if (!response) {
    return;
  }

  if (!response.ok) {
    const details = await response.text();
    console.warn(
      `Tenant provisioning failed for ${tenantId} via ${lastPath}:`,
      details || `status ${response.status}`
    );
    return;
  }

  let payload: unknown = null;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    payload = await response.json();
  }

  const containerId = parseContainerId(payload);
  await pool.query(
    `UPDATE tenants
     SET status = 'active',
         container_id = COALESCE($2, container_id)
     WHERE id = $1`,
    [tenantId, containerId]
  );
}
