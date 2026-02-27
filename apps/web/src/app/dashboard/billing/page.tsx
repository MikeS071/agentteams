import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import pool from "@/lib/db";
import BillingCheckoutButtons from "@/components/BillingCheckoutButtons";

type BillingPageProps = {
  searchParams?: {
    status?: string;
  };
};

async function getBalance(tenantId: string): Promise<number> {
  const result = await pool.query(
    "SELECT COALESCE(SUM(amount), 0) AS balance FROM credit_ledger WHERE tenant_id = $1",
    [tenantId]
  );

  return Number(result.rows[0]?.balance ?? 0);
}

export default async function BillingPage({ searchParams }: BillingPageProps) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    redirect("/login");
  }

  const balance = await getBalance(session.user.tenantId);
  const status = searchParams?.status;

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-text">Billing</h1>
        <p className="mt-1 text-sm text-text2">
          Buy credits for your tenant account.
        </p>
      </div>

      {status === "success" && (
        <div className="rounded-lg border border-green-700/40 bg-green-950/30 px-4 py-3 text-sm text-green-300">
          Payment succeeded. Credits will appear shortly.
        </div>
      )}
      {status === "cancelled" && (
        <div className="rounded-lg border border-yellow-700/40 bg-yellow-950/30 px-4 py-3 text-sm text-yellow-300">
          Checkout was cancelled.
        </div>
      )}

      <div className="rounded-xl border border-bg3 bg-bg2 p-6">
        <p className="text-sm text-text2">Current credit balance</p>
        <p className="mt-2 text-3xl font-bold text-text">${balance.toFixed(2)}</p>
      </div>

      <div className="rounded-xl border border-bg3 bg-bg2 p-6">
        <h2 className="text-lg font-medium text-text">Purchase credits</h2>
        <p className="mt-1 text-sm text-text2">
          Choose an amount and continue through Stripe Checkout.
        </p>
        <div className="mt-4">
          <BillingCheckoutButtons />
        </div>
      </div>
    </section>
  );
}
