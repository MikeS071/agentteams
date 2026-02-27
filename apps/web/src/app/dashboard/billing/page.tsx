export default function BillingPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 py-10">
      <h1 className="text-2xl font-semibold">Billing</h1>
      <p className="mt-2 text-text2">
        Stripe checkout integration can post to `/api/webhooks/stripe` to credit this tenant and resume service.
      </p>
    </main>
  );
}
