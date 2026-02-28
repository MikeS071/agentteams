import Link from "next/link";

export default function SettingsPage() {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="rounded-xl border border-[#242438] bg-[#101018] p-6 text-center">
        <h1 className="text-lg font-semibold text-gray-100">Settings</h1>
        <p className="mt-2 text-sm text-gray-400">Manage workspace integrations and preferences.</p>
        <Link
          href="/dashboard/settings/deploy"
          className="mt-4 inline-flex rounded-md bg-[#6c5ce7] px-3 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Open Deploy Settings
        </Link>
        <Link
          href="/dashboard/settings/channels"
          className="ml-2 mt-4 inline-flex rounded-md border border-[#3a3a52] px-3 py-2 text-sm font-medium text-gray-200 hover:bg-[#1a1a28]"
        >
          Open Channel Settings
        </Link>
      </div>
    </div>
  );
}
