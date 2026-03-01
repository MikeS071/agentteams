"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Bot,
  CheckCircle,
  CreditCard,
  Lock,
  MessageSquare,
  Network,
  Radio,
  Rocket,
  Settings,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";
import ApprovalsBadge from "@/components/ApprovalsBadge";
import { type Feature } from "@/lib/features";

export type SidebarIcon =
  | "message-square"
  | "radio"
  | "bot"
  | "users"
  | "check-circle"
  | "network"
  | "bar-chart-3"
  | "credit-card"
  | "user"
  | "settings"
  | "rocket";

export type SidebarItem = {
  href: string;
  label: string;
  icon: SidebarIcon;
  feature?: Feature;
};

type DashboardSidebarNavProps = {
  navItems: SidebarItem[];
  settingsItems: SidebarItem[];
  featureMap: Record<Feature, boolean>;
  onNavigate?: () => void;
  className?: string;
};

const iconMap: Record<SidebarIcon, LucideIcon> = {
  "message-square": MessageSquare,
  radio: Radio,
  bot: Bot,
  users: Users,
  "check-circle": CheckCircle,
  network: Network,
  "bar-chart-3": BarChart3,
  "credit-card": CreditCard,
  user: User,
  settings: Settings,
  rocket: Rocket,
};

function isSidebarItemEnabled(item: SidebarItem, featureMap: Record<Feature, boolean>) {
  return item.feature ? featureMap[item.feature] : true;
}

export default function DashboardSidebarNav({
  navItems,
  settingsItems,
  featureMap,
  onNavigate,
  className,
}: DashboardSidebarNavProps) {
  const pathname = usePathname();
  const currentPath = pathname ?? "";
  const enabledItems = [...navItems, ...settingsItems].filter((item) =>
    isSidebarItemEnabled(item, featureMap)
  );
  const activeHref = enabledItems
    .filter((item) => currentPath === item.href || currentPath.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  const wrapperClass = ["flex flex-col items-center gap-2", className].filter(Boolean).join(" ");
  const sectionBreakClass = "my-1 h-px w-10 bg-[#1d1d2c]";

  const renderItem = (item: SidebarItem) => {
    const Icon = iconMap[item.icon];
    const enabled = isSidebarItemEnabled(item, featureMap);
    const active = enabled && activeHref === item.href;
    const iconClass = active ? "h-5 w-5 text-[#a29bfe]" : "h-5 w-5 text-gray-400";
    const labelClass = active
      ? "text-center text-[11px] leading-tight text-[#a29bfe]"
      : "text-center text-[11px] leading-tight text-gray-500";

    if (enabled) {
      return (
        <Link
          key={item.href}
          href={item.href}
          title={item.label}
          onClick={onNavigate}
          className={[
            "relative flex h-14 w-16 flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 transition-colors hover:bg-[#131320]",
            active ? "bg-[#131320] ring-1 ring-inset ring-[#a29bfe]" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <Icon aria-hidden="true" className={iconClass} />
          <span className={labelClass}>{item.label}</span>
          {item.href === "/dashboard/approvals" ? (
            <span className="pointer-events-none absolute -right-2 -top-2 origin-top-right scale-75">
              <ApprovalsBadge />
            </span>
          ) : null}
        </Link>
      );
    }

    return (
      <span
        key={item.href}
        title={`${item.label} (Locked)`}
        className="relative flex h-14 w-16 cursor-not-allowed flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 opacity-70"
      >
        <Icon aria-hidden="true" className="h-5 w-5 text-gray-500" />
        <span className="text-center text-[11px] leading-tight text-gray-600">{item.label}</span>
        <Lock aria-hidden="true" className="absolute right-0 top-0 h-3 w-3 text-gray-500" />
      </span>
    );
  };

  return (
    <nav className={wrapperClass}>
      {navItems.map(renderItem)}
      <div className={sectionBreakClass} />
      {settingsItems.map(renderItem)}
    </nav>
  );
}
