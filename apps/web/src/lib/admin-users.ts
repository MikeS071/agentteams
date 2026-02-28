export const PAGE_SIZE = 25;

export const SORT_COLUMNS = {
  email: "u.email",
  name: "u.name",
  tenant: "tenant_label",
  role: "u.is_admin",
  lastActive: "last_active",
  signupDate: "u.created_at",
} as const;

export type SortKey = keyof typeof SORT_COLUMNS;

export function asSortKey(value: string | undefined): SortKey {
  if (value && value in SORT_COLUMNS) {
    return value as SortKey;
  }
  return "signupDate";
}

export function asSortDirection(value: string | undefined): "asc" | "desc" {
  return value === "asc" ? "asc" : "desc";
}

export function asPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function asStatusFilter(value: string | undefined): "all" | "active" | "suspended" {
  if (value === "active" || value === "suspended") {
    return value;
  }
  return "all";
}
