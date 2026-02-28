import TenantDetailClient from "./TenantDetailClient";

export const dynamic = "force-dynamic";

export default function AdminTenantDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return <TenantDetailClient tenantId={params.id} />;
}
