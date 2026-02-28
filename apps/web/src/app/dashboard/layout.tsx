import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import DashboardUserMenu from "@/components/DashboardUserMenu";
import { getTenantFeatureMap } from "@/lib/feature-policies";
import { type Feature } from "@/lib/features";

type NavItem = {
  href: string;
  label: string;
  feature?: Feature;
};

const navItems: NavItem[] = [
  { href: "/dashboard/chat", label: "Chat", feature: "webchat" },
  { href: "/dashboard/agents", label: "Agents" },
  { href: "/dashboard/usage", label: "Usage" },
];

const settingsItems: NavItem[] = [
  { href: "/dashboard/settings", label: "General" },
  { href: "/dashboard/settings/deploy", label: "Deploy", feature: "deploy" },
];

function LockIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 1 1 8 0v3" />
    </svg>
  );
}

function isNavItemEnabled(item: NavItem, featureMap: Record<Feature, boolean>) {
  return item.feature ? featureMap[item.feature] : true;
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login");
  }

  const featureMap = await getTenantFeatureMap(session.user.tenantId);

  return (
    <div className="flex min-h-screen bg-[#0a0a0f] text-gray-100">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-[#1d1d2c] bg-[#0d0d14] md:flex">
        <div className="border-b border-[#1d1d2c] px-5 py-4 text-lg font-semibold text-[#a29bfe]">AgentTeams</div>
        <nav className="flex flex-col gap-1 p-3">
          <p className="px-3 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Workspace</p>
          {navItems.map((item) => (
            isNavItemEnabled(item, featureMap) ? (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-2 text-sm text-gray-400 hover:bg-[#131320] hover:text-gray-200"
              >
                {item.label}
              </Link>
            ) : (
              <span
                key={item.href}
                className="flex cursor-not-allowed items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-500"
              >
                {item.label}
                <LockIcon />
              </span>
            )
          ))}
          <p className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Settings</p>
          {settingsItems.map((item) => (
            isNavItemEnabled(item, featureMap) ? (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-2 text-sm text-gray-400 hover:bg-[#131320] hover:text-gray-200"
              >
                {item.label}
              </Link>
            ) : (
              <span
                key={item.href}
                className="flex cursor-not-allowed items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-500"
              >
                {item.label}
                <LockIcon />
              </span>
            )
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-[#1d1d2c] bg-[#0d0d14] px-4 sm:px-6">
          <div className="md:hidden">
            <nav className="flex gap-3 text-sm">
              {[...navItems, ...settingsItems].map((item) => (
                isNavItemEnabled(item, featureMap) ? (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="text-gray-400"
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span key={item.href} className="inline-flex items-center gap-1 text-gray-500">
                    {item.label}
                    <LockIcon />
                  </span>
                )
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
