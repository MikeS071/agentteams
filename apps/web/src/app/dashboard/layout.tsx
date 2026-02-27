import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/login");
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl gap-8 px-4 py-8">
      <aside className="w-52 shrink-0 rounded-xl border border-bg3 bg-bg2 p-4">
        <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-text2">
          Dashboard
        </p>
        <nav className="space-y-2">
          <Link
            href="/dashboard/billing"
            className="block rounded-lg px-3 py-2 text-sm text-text hover:bg-bg3"
          >
            Billing
          </Link>
        </nav>
      </aside>
      <main className="flex-1">{children}</main>
    </div>
  );
}
