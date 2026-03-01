"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LogOut, User } from "lucide-react";
import { signOut } from "next-auth/react";

type DashboardSidebarUserMenuProps = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

export default function DashboardSidebarUserMenu({
  name,
  email,
  image,
}: DashboardSidebarUserMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const initial = (name || email || "U").charAt(0).toUpperCase();

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (!menuRef.current) {
        return;
      }
      if (!menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        title={name || email || "User menu"}
        onClick={() => setOpen((current) => !current)}
        className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-[#2a2a3d] bg-[#1a1a2e] text-sm font-semibold text-gray-200 hover:bg-[#151523]"
      >
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt={name || "User avatar"} className="h-full w-full object-cover" />
        ) : (
          initial
        )}
      </button>
      {open ? (
        <div className="absolute bottom-0 left-12 z-50 w-56 rounded-lg border border-[#2a2a3d] bg-[#0d0d14] p-2 shadow-2xl">
          <div className="border-b border-[#1d1d2c] px-3 py-2">
            <p className="truncate text-sm font-medium text-gray-100">{name || "User"}</p>
            <p className="truncate text-xs text-gray-400">{email}</p>
          </div>
          <Link
            href="/dashboard/profile"
            onClick={() => setOpen(false)}
            className="mt-1 flex items-center gap-2 rounded-md px-3 py-2 text-sm text-gray-300 hover:bg-[#131320]"
          >
            <User aria-hidden="true" className="h-4 w-4" />
            Profile
          </Link>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-red-400 hover:bg-[#131320]"
          >
            <LogOut aria-hidden="true" className="h-4 w-4" />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
