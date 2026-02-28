import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import PoliciesTable from "@/components/admin/PoliciesTable";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminPoliciesPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login");
  }

  if (!session.user.isAdmin) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-[#090911] px-4 py-6 text-gray-100 sm:px-6">
      <div className="mx-auto w-full max-w-7xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Tenant Feature Policies</h1>
            <p className="mt-1 text-sm text-gray-400">
              Control feature availability per tenant and apply bulk plan changes.
            </p>
          </div>
          <Link
            href="/dashboard"
            className="rounded-md border border-[#30304a] px-3 py-2 text-sm text-gray-300 hover:bg-[#171726]"
          >
            Back to Dashboard
          </Link>
        </div>

        <PoliciesTable />
      </div>
    </div>
  );
}
