import pool from "@/lib/db";

type ModelTableConfig = {
  tableName: "llm_models" | "models";
  hasDeletedAt: boolean;
  hasIsDeleted: boolean;
  hasProviderCostPer1k: boolean;
  hasInputPerM: boolean;
  hasOutputPerM: boolean;
  hasEnabled: boolean;
};

export type AdminModel = {
  id: string;
  name: string;
  provider: string;
  providerCostPer1k: number;
  markupPct: number;
  enabled: boolean;
  userPricePer1k: number;
  dailyRevenueCents: number;
  weeklyRevenueCents: number;
};

type ModelRow = {
  id: string;
  name: string;
  provider: string;
  provider_cost_per_1k: string | number;
  markup_pct: string | number;
  enabled: boolean;
  daily_revenue_cents: string | number;
  weekly_revenue_cents: string | number;
};

function parseDecimalNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return Number(value);
  }
  return 0;
}

function toAdminModel(row: ModelRow): AdminModel {
  const providerCostPer1k = parseDecimalNumber(row.provider_cost_per_1k);
  const markupPct = parseDecimalNumber(row.markup_pct);
  const userPricePer1k = providerCostPer1k * (1 + markupPct / 100);

  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    providerCostPer1k,
    markupPct,
    enabled: row.enabled,
    userPricePer1k,
    dailyRevenueCents: parseDecimalNumber(row.daily_revenue_cents),
    weeklyRevenueCents: parseDecimalNumber(row.weekly_revenue_cents),
  };
}

function validateMarkup(markupPct: number) {
  if (!Number.isFinite(markupPct) || markupPct < 0 || markupPct > 500) {
    throw new Error("Markup must be between 0 and 500");
  }
}

function validateCost(providerCostPer1k: number) {
  if (!Number.isFinite(providerCostPer1k) || providerCostPer1k <= 0) {
    throw new Error("Provider cost must be positive");
  }
}

async function getModelTableConfig(): Promise<ModelTableConfig> {
  const result = await pool.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name IN ('llm_models', 'models')`
  );

  if (result.rowCount === 0) {
    throw new Error("No model table found");
  }

  const hasLlmModels = result.rows.some((row) => row.table_name === "llm_models");
  const tableName: "llm_models" | "models" = hasLlmModels ? "llm_models" : "models";
  const columns = new Set(
    result.rows
      .filter((row) => row.table_name === tableName)
      .map((row) => row.column_name)
  );

  return {
    tableName,
    hasDeletedAt: columns.has("deleted_at"),
    hasIsDeleted: columns.has("is_deleted"),
    hasProviderCostPer1k: columns.has("provider_cost_per_1k_tokens"),
    hasInputPerM: columns.has("provider_cost_input_per_m"),
    hasOutputPerM: columns.has("provider_cost_output_per_m"),
    hasEnabled: columns.has("enabled"),
  };
}

function getProviderCostExpression(config: ModelTableConfig, alias: string): string {
  if (config.hasProviderCostPer1k) {
    return `${alias}.provider_cost_per_1k_tokens::numeric`;
  }
  if (config.hasInputPerM && config.hasOutputPerM) {
    return `((${alias}.provider_cost_input_per_m::numeric + ${alias}.provider_cost_output_per_m::numeric) / 200000.0)`;
  }
  if (config.hasInputPerM) {
    return `(${alias}.provider_cost_input_per_m::numeric / 100000.0)`;
  }
  throw new Error("No supported provider cost columns found");
}

function getSoftDeleteFilter(config: ModelTableConfig, alias: string): string {
  if (config.hasDeletedAt) {
    return `${alias}.deleted_at IS NULL`;
  }
  if (config.hasIsDeleted) {
    return `COALESCE(${alias}.is_deleted, FALSE) = FALSE`;
  }
  return "TRUE";
}

function getEnabledExpression(config: ModelTableConfig, alias: string): string {
  if (config.hasEnabled) {
    return `COALESCE(${alias}.enabled, TRUE)`;
  }
  return "TRUE";
}

function makeModelId(name: string, provider: string) {
  const base = `${provider}-${name}`
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base || "model"}-${suffix}`;
}

export function assertValidMarkup(markupPct: number) {
  validateMarkup(markupPct);
}

export function assertValidCost(providerCostPer1k: number) {
  validateCost(providerCostPer1k);
}

export async function listAdminModels(): Promise<AdminModel[]> {
  const config = await getModelTableConfig();
  const providerCostExpr = getProviderCostExpression(config, "m");
  const softDeleteFilter = getSoftDeleteFilter(config, "m");
  const enabledExpr = getEnabledExpression(config, "m");

  const result = await pool.query<ModelRow>(
    `SELECT
       m.id,
       m.name,
       m.provider,
       ${providerCostExpr} AS provider_cost_per_1k,
       m.markup_pct,
       ${enabledExpr} AS enabled,
       COALESCE(r.daily_revenue_cents, 0) AS daily_revenue_cents,
       COALESCE(r.weekly_revenue_cents, 0) AS weekly_revenue_cents
     FROM ${config.tableName} m
     LEFT JOIN (
       SELECT
         model,
         SUM(CASE WHEN created_at >= NOW() - INTERVAL '1 day' THEN (cost_cents + margin_cents) ELSE 0 END) AS daily_revenue_cents,
         SUM(CASE WHEN created_at >= NOW() - INTERVAL '7 day' THEN (cost_cents + margin_cents) ELSE 0 END) AS weekly_revenue_cents
       FROM usage_logs
       GROUP BY model
     ) r ON r.model = m.id
     WHERE ${softDeleteFilter}
     ORDER BY m.provider ASC, m.name ASC`
  );

  return result.rows.map(toAdminModel);
}

export async function createAdminModel(input: {
  name: string;
  provider: string;
  providerCostPer1k: number;
  markupPct: number;
}): Promise<AdminModel> {
  const name = input.name.trim();
  const provider = input.provider.trim().toLowerCase();
  validateCost(input.providerCostPer1k);
  validateMarkup(input.markupPct);

  if (!name) {
    throw new Error("Name is required");
  }
  if (!provider) {
    throw new Error("Provider is required");
  }

  const config = await getModelTableConfig();
  const id = makeModelId(name, provider);

  const columns = ["id", "name", "provider", "markup_pct"];
  const values: Array<string | number | boolean> = [id, name, provider, input.markupPct];
  const placeholders = ["$1", "$2", "$3", "$4"];
  let nextIndex = 5;

  if (config.hasProviderCostPer1k) {
    columns.push("provider_cost_per_1k_tokens");
    values.push(input.providerCostPer1k);
    placeholders.push(`$${nextIndex++}`);
  } else {
    const providerCostPerMInCents = Math.round(input.providerCostPer1k * 100000);
    if (config.hasInputPerM) {
      columns.push("provider_cost_input_per_m");
      values.push(providerCostPerMInCents);
      placeholders.push(`$${nextIndex++}`);
    }
    if (config.hasOutputPerM) {
      columns.push("provider_cost_output_per_m");
      values.push(providerCostPerMInCents);
      placeholders.push(`$${nextIndex++}`);
    }
  }

  if (config.hasEnabled) {
    columns.push("enabled");
    values.push(true);
    placeholders.push(`$${nextIndex++}`);
  }

  await pool.query(
    `INSERT INTO ${config.tableName} (${columns.join(", ")})
     VALUES (${placeholders.join(", ")})`,
    values
  );

  const models = await listAdminModels();
  const created = models.find((model) => model.id === id);
  if (!created) {
    throw new Error("Failed to load created model");
  }
  return created;
}

export async function updateAdminModel(
  id: string,
  patch: { markupPct?: number; enabled?: boolean }
): Promise<AdminModel> {
  const config = await getModelTableConfig();
  const setClauses: string[] = [];
  const values: Array<string | number | boolean> = [id];
  let idx = 2;

  if (typeof patch.markupPct === "number") {
    validateMarkup(patch.markupPct);
    setClauses.push(`markup_pct = $${idx++}`);
    values.push(patch.markupPct);
  }

  if (typeof patch.enabled === "boolean" && config.hasEnabled) {
    setClauses.push(`enabled = $${idx++}`);
    values.push(patch.enabled);
  }

  if (setClauses.length === 0) {
    throw new Error("No valid fields to update");
  }

  const softDeleteFilter = getSoftDeleteFilter(config, config.tableName);

  const updateResult = await pool.query(
    `UPDATE ${config.tableName}
     SET ${setClauses.join(", ")}
     WHERE id = $1
       AND ${softDeleteFilter}
     RETURNING id`,
    values
  );

  if (updateResult.rowCount === 0) {
    throw new Error("Model not found");
  }

  const models = await listAdminModels();
  const updated = models.find((model) => model.id === id);
  if (!updated) {
    throw new Error("Failed to load updated model");
  }
  return updated;
}

export async function softDeleteAdminModel(id: string): Promise<void> {
  const config = await getModelTableConfig();

  if (config.hasDeletedAt) {
    if (config.hasEnabled) {
      await pool.query(
        `UPDATE ${config.tableName}
         SET deleted_at = NOW(), enabled = FALSE
         WHERE id = $1`,
        [id]
      );
      return;
    }
    await pool.query(
      `UPDATE ${config.tableName}
       SET deleted_at = NOW()
       WHERE id = $1`,
      [id]
    );
    return;
  }

  if (config.hasIsDeleted) {
    if (config.hasEnabled) {
      await pool.query(
        `UPDATE ${config.tableName}
         SET is_deleted = TRUE, enabled = FALSE
         WHERE id = $1`,
        [id]
      );
      return;
    }
    await pool.query(
      `UPDATE ${config.tableName}
       SET is_deleted = TRUE
       WHERE id = $1`,
      [id]
    );
    return;
  }

  if (config.hasEnabled) {
    await pool.query(
      `UPDATE ${config.tableName}
       SET enabled = FALSE
       WHERE id = $1`,
      [id]
    );
    return;
  }

  throw new Error("Soft delete is not supported by the current schema");
}
