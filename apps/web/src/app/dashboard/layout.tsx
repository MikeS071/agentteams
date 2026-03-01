import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import DashboardUserMenu from "@/components/DashboardUserMenu";
import DashboardMobileSidebar from "@/components/DashboardMobileSidebar";
import DashboardSidebarNav, { type SidebarIcon, type SidebarItem } from "@/components/DashboardSidebarNav";
import DashboardSidebarUserMenu from "@/components/DashboardSidebarUserMenu";
import { getTenantFeatureMap } from "@/lib/feature-policies";
import { type Feature } from "@/lib/features";

type NavItem = {
  href: string;
  label: string;
  icon: SidebarIcon;
  feature?: Feature;
};

const navItems: NavItem[] = [
  { href: "/dashboard/chat", label: "Chat", icon: "message-square", feature: "webchat" },
  { href: "/dashboard/channels", label: "Channels", icon: "radio" },
  { href: "/dashboard/agents", label: "Agents", icon: "users" },
  { href: "/dashboard/approvals", label: "Approvals", icon: "check-circle" },
  { href: "/dashboard/swarm", label: "Swarm", icon: "network" },
  { href: "/dashboard/usage", label: "Usage", icon: "bar-chart-3" },
  { href: "/dashboard/billing", label: "Billing", icon: "credit-card" },
];

const settingsItems: NavItem[] = [
  { href: "/dashboard/profile", label: "Profile", icon: "user" },
  { href: "/dashboard/settings", label: "Settings", icon: "settings" },
  { href: "/dashboard/settings/deploy", label: "Deploy", icon: "rocket", feature: "deploy" },
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

  const featureMap = await getTenantFeatureMap(session.user.tenantId);
  const navItemsWithIcons = navItems as SidebarItem[];
  const settingsItemsWithIcons = settingsItems as SidebarItem[];

  return (
    <div className="flex h-screen overflow-hidden bg-[#0a0a0f] text-gray-100">
      <aside className="hidden w-16 shrink-0 flex-col border-r border-[#1d1d2c] bg-[#0d0d14] md:flex">
        <div className="flex h-16 items-center justify-center border-b border-[#1d1d2c]">
          <Link
            href="/dashboard/chat"
            title="AgentSquads"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-xl"
          >
            🤖
          </Link>
        </div>
        <DashboardSidebarNav
          navItems={navItemsWithIcons}
          settingsItems={settingsItemsWithIcons}
          featureMap={featureMap}
          className="flex-1 overflow-y-auto py-3"
        />
        <div className="flex justify-center border-t border-[#1d1d2c] p-3">
          <DashboardSidebarUserMenu
            name={session.user.name}
            email={session.user.email}
            image={session.user.image}
          />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-[#1d1d2c] bg-[#0d0d14] px-4 sm:px-6">
          <DashboardMobileSidebar
            navItems={navItemsWithIcons}
            settingsItems={settingsItemsWithIcons}
            featureMap={featureMap}
          />
          <p className="hidden text-sm text-gray-400 md:block">Dashboard</p>
          <div className="md:hidden">
            <DashboardUserMenu
              name={session.user.name}
              email={session.user.email}
              image={session.user.image}
            />
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
