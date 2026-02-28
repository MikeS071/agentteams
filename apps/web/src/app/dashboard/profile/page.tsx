import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import ProfilePageClient from "./profile-page-client";

export default async function ProfilePage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/login");
  }

  return (
    <div className="h-full overflow-y-auto bg-[#0a0a0f] px-4 py-6 sm:px-6">
      <div className="mx-auto w-full max-w-5xl">
        <ProfilePageClient
          sessionUser={{
            name: session.user.name ?? null,
            email: session.user.email ?? null,
            image: session.user.image ?? null,
          }}
        />
      </div>
    </div>
  );
}
