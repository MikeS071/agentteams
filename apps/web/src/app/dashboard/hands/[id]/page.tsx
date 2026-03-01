import { redirect } from "next/navigation";

export default async function LegacyDashboardAgentDetailRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/dashboard/ai-agents/${encodeURIComponent(id)}`);
}
