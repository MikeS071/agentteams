import Link from "next/link";
import UserMenu from "@/components/UserMenu";
import DashboardBalance from "@/components/DashboardBalance";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-bg3 bg-bg2">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="text-lg font-semibold text-text">
              AgentTeams
            </Link>
            <nav className="flex items-center gap-3 text-sm">
              <Link
                href="/dashboard/usage"
                className="rounded-md px-3 py-1.5 text-text2 transition hover:bg-bg3 hover:text-text"
              >
                Usage
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <DashboardBalance />
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
