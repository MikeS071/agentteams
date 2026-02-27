import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import DashboardUserMenu from "@/components/DashboardUserMenu";

const navItems = [
  { href: "/dashboard/chat", label: "Chat" },
  { href: "/dashboard/usage", label: "Usage" },
  { href: "/dashboard/settings", label: "Settings" },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen bg-[#0a0a0f] text-gray-100">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-[#1d1d2c] bg-[#0d0d14] md:flex">
        <div className="border-b border-[#1d1d2c] px-5 py-4 text-lg font-semibold text-[#a29bfe]">AgentTeams</div>
        <nav className="flex flex-col gap-1 p-3">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-lg px-3 py-2 text-sm ${
                item.href === "/dashboard/chat"
                  ? "bg-[#171726] text-[#a29bfe]"
                  : "text-gray-400 hover:bg-[#131320] hover:text-gray-200"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-[#1d1d2c] bg-[#0d0d14] px-4 sm:px-6">
          <div className="md:hidden">
            <nav className="flex gap-3 text-sm">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={item.href === "/dashboard/chat" ? "text-[#a29bfe]" : "text-gray-400"}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <p className="hidden text-sm text-gray-400 md:block">Dashboard</p>
          <DashboardUserMenu
            name={session.user.name}
            email={session.user.email}
            image={session.user.image}
          />
        </header>
        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
