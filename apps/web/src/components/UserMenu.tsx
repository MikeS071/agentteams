"use client";

import { useSession, signOut } from "next-auth/react";
import { useState } from "react";

export default function UserMenu() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);

  if (!session?.user) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-lg border border-bg3 bg-bg2 px-3 py-2 text-sm text-text hover:bg-bg3"
      >
        {session.user.name || session.user.email}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-56 rounded-lg border border-bg3 bg-bg2 p-2 shadow-lg">
          <div className="border-b border-bg3 px-3 py-2">
            <p className="text-sm font-medium text-text">{session.user.name}</p>
            <p className="text-xs text-text2">{session.user.email}</p>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="mt-1 w-full rounded-md px-3 py-2 text-left text-sm text-red-400 hover:bg-bg3"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
