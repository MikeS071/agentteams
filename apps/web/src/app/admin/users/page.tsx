import pool from "@/lib/db";
import UserActionButtons from "@/components/admin/UserActionButtons";

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  tenant_id: string | null;
  role: "user" | "admin" | "disabled";
  last_active: string | Date;
};

function formatDate(value: string | Date) {
  return new Date(value).toLocaleString();
}

export default async function AdminUsersPage() {
  const result = await pool.query<UserRow>(`
    SELECT
      u.id,
      u.email,
      u.name,
      t.id AS tenant_id,
      u.role,
      GREATEST(
        u.updated_at,
        COALESCE((SELECT MAX(created_at) FROM usage_logs ul WHERE ul.tenant_id = t.id), u.updated_at),
        COALESCE((SELECT MAX(created_at) FROM conversations c WHERE c.tenant_id = t.id), u.updated_at)
      ) AS last_active
    FROM users u
    LEFT JOIN tenants t ON t.user_id = u.id
    ORDER BY last_active DESC
  `);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-gray-100">Users</h1>
        <p className="mt-1 text-sm text-gray-400">Manage account access, roles, and credentials.</p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[#1f1f30] bg-[#121220]">
        <table className="min-w-full divide-y divide-[#27273a]">
          <thead className="bg-[#151523]">
            <tr className="text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Tenant</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Last Active</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#27273a]">
            {result.rows.map((user) => (
              <tr key={user.id} className="text-sm text-gray-200">
                <td className="px-4 py-3">{user.email}</td>
                <td className="px-4 py-3">{user.name || "—"}</td>
                <td className="px-4 py-3 text-gray-300">{user.tenant_id || "—"}</td>
                <td className="px-4 py-3 capitalize text-gray-300">{user.role}</td>
                <td className="px-4 py-3 text-gray-300">{formatDate(user.last_active)}</td>
                <td className="px-4 py-3">
                  <UserActionButtons userId={user.id} role={user.role} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
