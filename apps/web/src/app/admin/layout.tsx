import Link from "next/link";
import DashboardUserMenu from "@/components/DashboardUserMenu";
import { requireAdminPage } from "@/lib/admin";

const navItems = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/tenants", label: "Tenants" },
  { href: "/admin/users", label: "Users" },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireAdminPage();

  return (
    <div className="flex min-h-screen bg-[#0a0a0f] text-gray-100">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-[#1d1d2c] bg-[#0d0d14] md:flex">
        <div className="border-b border-[#1d1d2c] px-5 py-4">
          <p className="text-lg font-semibold text-[#f8c85c]">Platform Admin</p>
          <p className="mt-1 text-xs text-gray-500">AgentTeams control plane</p>
        </div>
        <nav className="flex flex-col gap-1 p-3">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg px-3 py-2 text-sm text-gray-300 hover:bg-[#171725]"
            >
              {item.label}
            </Link>
          ))}
          <div className="mt-2 border-t border-[#1f1f30] pt-2">
            <Link
              href="/dashboard"
              className="rounded-lg px-3 py-2 text-sm text-gray-400 hover:bg-[#171725] hover:text-gray-200"
            >
              Back to Dashboard
            </Link>
          </div>
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-[#1d1d2c] bg-[#0d0d14] px-4 sm:px-6">
          <div className="md:hidden">
            <nav className="flex gap-3 text-sm text-gray-300">
              {navItems.map((item) => (
                <Link key={item.href} href={item.href}>
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <p className="hidden text-sm text-gray-400 md:block">Platform Administration</p>
          <DashboardUserMenu
            name={session.user.name}
            email={session.user.email}
            image={session.user.image}
          />
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto bg-[#0a0a0f] p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
