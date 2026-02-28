import { redirect } from "next/navigation";
import ModelsAdminClient from "./ModelsAdminClient";
import { requireAdminSession } from "@/lib/adminAuth";
import { listAdminModels } from "@/lib/adminModels";

export const dynamic = "force-dynamic";

export default async function AdminModelsPage() {
  const admin = await requireAdminSession();
  if (!admin.ok) {
    if (admin.status === 401) {
      redirect("/login");
    }
    redirect("/dashboard");
  }

  const models = await listAdminModels();

  return <ModelsAdminClient initialModels={models} />;
}
