"use client";

import { signOut } from "next-auth/react";

type DashboardUserMenuProps = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

export default function DashboardUserMenu({ name, email, image }: DashboardUserMenuProps) {
  const initial = (name || email || "U").charAt(0).toUpperCase();

  return (
    <div className="flex items-center gap-3">
      <div className="hidden text-right sm:block">
        <p className="text-sm font-medium text-gray-100">{name || "User"}</p>
        <p className="text-xs text-gray-400">{email}</p>
      </div>
      <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-[#1a1a2e] text-sm font-semibold text-gray-200">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt={name || "User avatar"} className="h-full w-full object-cover" />
        ) : (
          initial
        )}
      </div>
      <button
        type="button"
        onClick={() => signOut({ callbackUrl: "/login" })}
        className="rounded-lg border border-[#2a2a3d] px-3 py-1.5 text-sm text-gray-300 hover:bg-[#151523]"
      >
        Sign out
      </button>
    </div>
  );
}
