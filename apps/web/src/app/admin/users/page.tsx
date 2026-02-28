import Link from "next/link";
import { redirect } from "next/navigation";
import pool from "@/lib/db";
import { getAdminSession } from "@/lib/admin-auth";
import {
  PAGE_SIZE,
  SORT_COLUMNS,
  asPositiveInt,
  asSortDirection,
  asSortKey,
  asStatusFilter,
  type SortKey,
} from "@/lib/admin-users";

type SearchParams = Record<string, string | string[] | undefined>;

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  tenant_id: string | null;
  tenant_label: string | null;
  is_admin: boolean;
  suspended_at: string | null;
  created_at: string;
  last_active: string | null;
};

type TenantOption = {
  id: string;
  email: string;
};

function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function buildHref(params: URLSearchParams, patch: Record<string, string | null>) {
  const next = new URLSearchParams(params);

  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === "") {
      next.delete(key);
    } else {
      next.set(key, value);
    }
  }

  const query = next.toString();
  return query ? `/admin/users?${query}` : "/admin/users";
}

function sortLink(params: URLSearchParams, sort: SortKey, currentSort: SortKey, currentDir: "asc" | "desc") {
  const nextDir = currentSort === sort && currentDir === "asc" ? "desc" : "asc";
  return buildHref(params, { sort, dir: nextDir, page: "1" });
}

function formatDate(date: string | null) {
  if (!date) return "-";
  return new Date(date).toLocaleDateString();
}

export const dynamic = "force-dynamic";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await getAdminSession();

  if (!session?.user) {
    redirect("/login");
  }

  const query = first(searchParams.q)?.trim() ?? "";
  const status = asStatusFilter(first(searchParams.status));
  const tenant = first(searchParams.tenant) ?? "";
  const signupFrom = first(searchParams.signupFrom) ?? "";
  const signupTo = first(searchParams.signupTo) ?? "";
  const sort = asSortKey(first(searchParams.sort));
  const dir = asSortDirection(first(searchParams.dir));
  const page = asPositiveInt(first(searchParams.page), 1);

  const whereParts: string[] = ["u.deleted_at IS NULL"];
  const values: Array<string | number> = [];

  if (query) {
    values.push(`%${query}%`);
    whereParts.push(`(u.email ILIKE $${values.length} OR COALESCE(u.name, '') ILIKE $${values.length})`);
  }

  if (status === "active") {
    whereParts.push("u.suspended_at IS NULL");
  } else if (status === "suspended") {
    whereParts.push("u.suspended_at IS NOT NULL");
  }

  if (tenant) {
    values.push(tenant);
    whereParts.push(`t.id = $${values.length}`);
  }

  if (signupFrom) {
    values.push(signupFrom);
    whereParts.push(`u.created_at::date >= $${values.length}::date`);
  }

  if (signupTo) {
    values.push(signupTo);
    whereParts.push(`u.created_at::date <= $${values.length}::date`);
  }

  const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";
  const orderBy = SORT_COLUMNS[sort];

  const countResult = await pool.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total
     FROM users u
     LEFT JOIN tenants t ON t.user_id = u.id
     ${whereSql}`,
    values
  );

  const total = Number(countResult.rows[0]?.total ?? "0");
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const offset = (currentPage - 1) * PAGE_SIZE;

  const listValues = [...values, PAGE_SIZE, offset];
  const usersResult = await pool.query<UserRow>(
    `SELECT
       u.id,
       u.email,
       u.name,
       t.id AS tenant_id,
       t.id::text AS tenant_label,
       u.is_admin,
       u.suspended_at::text,
       u.created_at::text,
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
     ${whereSql}
     ORDER BY ${orderBy} ${dir.toUpperCase()} NULLS LAST, u.id DESC
     LIMIT $${values.length + 1}
     OFFSET $${values.length + 2}`,
    listValues
  );

  const tenantsResult = await pool.query<TenantOption>(
    `SELECT t.id, u.email
     FROM tenants t
     JOIN users u ON u.id = t.user_id
     WHERE u.deleted_at IS NULL
     ORDER BY u.email ASC`
  );

  const currentParams = new URLSearchParams();
  const entries: Record<string, string> = {
    q: query,
    status,
    tenant,
    signupFrom,
    signupTo,
    sort,
    dir,
    page: String(currentPage),
  };
  for (const [key, value] of Object.entries(entries)) {
    if (value) currentParams.set(key, value);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Users</h1>
        <p className="text-sm text-gray-400">Manage user access, roles, and credits.</p>
      </div>

      <form className="grid gap-3 rounded-xl border border-[#1d1d2c] bg-[#11111a] p-4 md:grid-cols-5" method="GET">
        <input
          type="text"
          name="q"
          placeholder="Search email or name"
          defaultValue={query}
          className="rounded-md border border-[#24243a] bg-[#0d0d14] px-3 py-2 text-sm text-gray-100"
        />
        <select
          name="status"
          defaultValue={status}
          className="rounded-md border border-[#24243a] bg-[#0d0d14] px-3 py-2 text-sm text-gray-100"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
        <select
          name="tenant"
          defaultValue={tenant}
          className="rounded-md border border-[#24243a] bg-[#0d0d14] px-3 py-2 text-sm text-gray-100"
        >
          <option value="">All tenants</option>
          {tenantsResult.rows.map((row) => (
            <option key={row.id} value={row.id}>
              {row.email}
            </option>
          ))}
        </select>
        <input
          type="date"
          name="signupFrom"
          defaultValue={signupFrom}
          className="rounded-md border border-[#24243a] bg-[#0d0d14] px-3 py-2 text-sm text-gray-100"
        />
        <input
          type="date"
          name="signupTo"
          defaultValue={signupTo}
          className="rounded-md border border-[#24243a] bg-[#0d0d14] px-3 py-2 text-sm text-gray-100"
        />
        <input type="hidden" name="sort" value={sort} />
        <input type="hidden" name="dir" value={dir} />
        <button className="rounded-md bg-[#6c5ce7] px-3 py-2 text-sm font-medium text-white md:col-span-2" type="submit">
          Apply Filters
        </button>
      </form>

      <div className="overflow-x-auto rounded-xl border border-[#1d1d2c] bg-[#11111a]">
        <table className="min-w-full text-sm">
          <thead className="bg-[#0f0f18] text-left text-xs uppercase tracking-wide text-gray-400">
            <tr>
              <th className="px-4 py-3"><Link href={sortLink(currentParams, "email", sort, dir)}>Email</Link></th>
              <th className="px-4 py-3"><Link href={sortLink(currentParams, "name", sort, dir)}>Name</Link></th>
              <th className="px-4 py-3"><Link href={sortLink(currentParams, "tenant", sort, dir)}>Tenant</Link></th>
              <th className="px-4 py-3"><Link href={sortLink(currentParams, "role", sort, dir)}>Role</Link></th>
              <th className="px-4 py-3"><Link href={sortLink(currentParams, "lastActive", sort, dir)}>Last Active</Link></th>
              <th className="px-4 py-3"><Link href={sortLink(currentParams, "signupDate", sort, dir)}>Signup Date</Link></th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {usersResult.rows.map((user) => (
              <tr key={user.id} className="border-t border-[#1d1d2c] text-gray-200">
                <td className="px-4 py-3">
                  <Link href={`/admin/users/${user.id}`} className="text-[#a29bfe] hover:underline">
                    {user.email}
                  </Link>
                </td>
                <td className="px-4 py-3">{user.name || "-"}</td>
                <td className="px-4 py-3">{user.tenant_label ? user.tenant_label.slice(0, 8) : "-"}</td>
                <td className="px-4 py-3">{user.is_admin ? "admin" : "user"}</td>
                <td className="px-4 py-3">{formatDate(user.last_active)}</td>
                <td className="px-4 py-3">{formatDate(user.created_at)}</td>
                <td className="px-4 py-3">
                  {user.suspended_at ? (
                    <span className="rounded-full bg-red-500/20 px-2 py-1 text-xs text-red-200">Suspended</span>
                  ) : (
                    <span className="rounded-full bg-emerald-500/20 px-2 py-1 text-xs text-emerald-200">Active</span>
                  )}
                </td>
              </tr>
            ))}
            {usersResult.rows.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-gray-400" colSpan={7}>
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-gray-300">
        <p>
          Page {currentPage} of {totalPages} ({total} users)
        </p>
        <div className="flex gap-2">
          <Link
            href={buildHref(currentParams, { page: String(Math.max(1, currentPage - 1)) })}
            className={`rounded-md border px-3 py-1 ${currentPage <= 1 ? "pointer-events-none border-[#2a2a40] text-gray-500" : "border-[#3f3f62] text-gray-200"}`}
          >
            Previous
          </Link>
          <Link
            href={buildHref(currentParams, { page: String(Math.min(totalPages, currentPage + 1)) })}
            className={`rounded-md border px-3 py-1 ${currentPage >= totalPages ? "pointer-events-none border-[#2a2a40] text-gray-500" : "border-[#3f3f62] text-gray-200"}`}
          >
            Next
          </Link>
        </div>
      </div>
    </div>
  );
}
