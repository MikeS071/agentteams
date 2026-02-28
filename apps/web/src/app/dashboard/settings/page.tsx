import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { getTenantFeatureMap } from "@/lib/feature-policies";

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

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  const tenantId = session?.user?.tenantId;

  if (!tenantId) {
    redirect("/login");
  }

  const featureMap = await getTenantFeatureMap(tenantId);
  const deployEnabled = featureMap.deploy;

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="rounded-xl border border-[#242438] bg-[#101018] p-6 text-center">
        <h1 className="text-lg font-semibold text-gray-100">Settings</h1>
        <p className="mt-2 text-sm text-gray-400">Manage workspace integrations and preferences.</p>
        {deployEnabled ? (
          <Link
            href="/dashboard/settings/deploy"
            className="mt-4 inline-flex rounded-md bg-[#6c5ce7] px-3 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Open Deploy Settings
          </Link>
        ) : (
          <span className="mt-4 inline-flex items-center gap-2 rounded-md border border-[#3b3b52] bg-[#191926] px-3 py-2 text-sm font-medium text-gray-300">
            <LockIcon />
            Deploy locked
          </span>
        )}
      </div>
    </div>
  );
}
