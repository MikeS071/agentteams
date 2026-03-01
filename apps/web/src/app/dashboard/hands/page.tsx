import { redirect } from "next/navigation";

export default function LegacyDashboardAgentsRedirect() {
  redirect("/dashboard/ai-agents");
}
