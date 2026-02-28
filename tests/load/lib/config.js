const DEFAULT_WEB_BASE_URL = "http://localhost:3000";
const DEFAULT_API_BASE_URL = "http://localhost:8080";

function parseCsv(input) {
  if (!input) {
    return [];
  }
  return input
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export const config = {
  webBaseUrl: (__ENV.WEB_BASE_URL || DEFAULT_WEB_BASE_URL).replace(/\/$/, ""),
  apiBaseUrl: (__ENV.API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/$/, ""),
  llmModel: __ENV.LLM_MODEL || "gpt-4o-mini",
  scenarioDuration: __ENV.SCENARIO_DURATION || "10m",
  wsDuration: __ENV.WS_DURATION || "60m",
  tenantIds: parseCsv(__ENV.TENANT_IDS),
  wsTenantIds: parseCsv(__ENV.WS_TENANT_IDS || __ENV.TENANT_IDS),
  inferenceBudgetMs: Number(__ENV.INFERENCE_BUDGET_MS || "0"),
};

export function randomString(prefix = "load") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function randomTenantId(index, fallbackPrefix = "tenant") {
  if (config.tenantIds.length === 0) {
    return `${fallbackPrefix}-${index + 1}`;
  }
  return config.tenantIds[index % config.tenantIds.length];
}

export function randomWsTenantId(index) {
  if (config.wsTenantIds.length === 0) {
    return "";
  }
  return config.wsTenantIds[index % config.wsTenantIds.length];
}
