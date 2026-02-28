"use client";

type ProfilePageClientProps = {
  sessionUser: {
    name: string | null;
    email: string | null;
    image: string | null;
  };
};

export default function ProfilePageClient({ sessionUser }: ProfilePageClientProps) {
  return (
    <section className="rounded-2xl border border-[#2a2a3d] bg-[#12121f] p-6">
      <p className="text-xs uppercase tracking-[0.16em] text-[#a0a0b8]">Profile</p>
      <h1 className="mt-2 text-2xl font-semibold text-[#e8e8f0]">Account Details</h1>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <article className="rounded-xl border border-[#2a2a3d] bg-[#16162a] p-4">
          <p className="text-xs uppercase tracking-wide text-[#a0a0b8]">Name</p>
          <p className="mt-2 text-base text-[#e8e8f0]">{sessionUser.name ?? "Not set"}</p>
        </article>
        <article className="rounded-xl border border-[#2a2a3d] bg-[#16162a] p-4">
          <p className="text-xs uppercase tracking-wide text-[#a0a0b8]">Email</p>
          <p className="mt-2 text-base text-[#e8e8f0]">{sessionUser.email ?? "Not set"}</p>
        </article>
      </div>
    </section>
  );
}
