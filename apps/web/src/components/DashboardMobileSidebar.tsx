"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import DashboardSidebarNav, { type SidebarItem } from "@/components/DashboardSidebarNav";
import { type Feature } from "@/lib/features";

type DashboardMobileSidebarProps = {
  navItems: SidebarItem[];
  settingsItems: SidebarItem[];
  featureMap: Record<Feature, boolean>;
};

export default function DashboardMobileSidebar({
  navItems,
  settingsItems,
  featureMap,
}: DashboardMobileSidebarProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-label="Open sidebar"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-[#2a2a3d] p-2 text-gray-300 hover:bg-[#131320]"
      >
        <Menu aria-hidden="true" className="h-5 w-5" />
      </button>
      {open ? (
        <>
          <button
            type="button"
            aria-label="Close sidebar overlay"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 bg-black/50"
          />
          <aside className="fixed inset-y-0 left-0 z-40 flex w-20 flex-col border-r border-[#1d1d2c] bg-[#0d0d14]">
            <div className="flex h-16 items-center justify-center border-b border-[#1d1d2c]">
              <Link
                href="/dashboard/chat"
                title="AgentSquads"
                onClick={() => setOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-lg text-xl"
              >
                🤖
              </Link>
            </div>
            <DashboardSidebarNav
              navItems={navItems}
              settingsItems={settingsItems}
              featureMap={featureMap}
              onNavigate={() => setOpen(false)}
              className="flex-1 overflow-y-auto py-3"
            />
            <div className="flex justify-center border-t border-[#1d1d2c] p-3">
              <button
                type="button"
                aria-label="Close sidebar"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-[#2a2a3d] p-2 text-gray-300 hover:bg-[#131320]"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
          </aside>
        </>
      ) : null}
    </div>
  );
}
