import Link from "next/link";

const links = [
  { href: "/onboarding", label: "Onboarding" },
  { href: "/dashboard/chat", label: "Chat + Agent Grid" },
  { href: "/dashboard/channels", label: "Channels" },
  { href: "/dashboard/swarm", label: "Agent Swarm" },
  { href: "/dashboard/deploy", label: "Deploy (Vercel + Supabase)" },
  { href: "/dashboard/billing", label: "Billing" },
  { href: "/pricing", label: "Pricing" },
  { href: "/admin", label: "Admin" },
];

export default function DocsPage() {
  return (
    <main className="min-h-screen bg-bg px-4 py-16 text-text sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl rounded-2xl border border-bg3 bg-bg2 p-8">
        <p className="text-xs uppercase tracking-[0.18em] text-accent2">Docs</p>
        <h1 className="mt-3 text-3xl font-black sm:text-4xl">AgentSquads Product Guide</h1>
        <p className="mt-4 text-sm text-text2 sm:text-base">
          This page links to the core product surfaces available today.
        </p>

        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {links.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg border border-bg3 bg-bg px-4 py-3 text-sm text-text2 transition hover:border-accent2 hover:text-text"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
