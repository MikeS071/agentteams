"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import Link from "next/link";

const oauthProviders = [
  { id: "google", label: "Google", bg: "bg-white text-gray-900" },
  { id: "github", label: "GitHub", bg: "bg-gray-800 text-white" },
  { id: "facebook", label: "Facebook", bg: "bg-blue-600 text-white" },
  { id: "twitter", label: "X (Twitter)", bg: "bg-black text-white border border-gray-700" },
  { id: "linkedin", label: "LinkedIn", bg: "bg-blue-700 text-white" },
];

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = await signIn("credentials", {
      email,
      password,
      redirect: true,
      callbackUrl: "/dashboard/chat",
    });
    if (res?.error) setError("Invalid email or password");
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md space-y-6 rounded-xl border border-bg3 bg-bg2 p-8">
        <h1 className="text-center text-2xl font-bold text-text">Sign in to AgentSquads</h1>

        <div className="space-y-3">
          {oauthProviders.map((p) => (
            <button
              key={p.id}
              onClick={() => signIn(p.id, { callbackUrl: "/dashboard/chat" })}
              className={`w-full rounded-lg px-4 py-2.5 font-medium transition-opacity hover:opacity-90 ${p.bg}`}
            >
              Continue with {p.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 text-text2">
          <div className="h-px flex-1 bg-bg3" />
          <span className="text-sm">or</span>
          <div className="h-px flex-1 bg-bg3" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="text-sm text-red-400">{error}</p>}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-bg3 bg-bg px-4 py-2.5 text-text placeholder-text2 focus:border-accent focus:outline-none"
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-bg3 bg-bg px-4 py-2.5 text-text placeholder-text2 focus:border-accent focus:outline-none"
            required
          />
          <button
            type="submit"
            className="w-full rounded-lg bg-accent px-4 py-2.5 font-medium text-white transition-opacity hover:opacity-90"
          >
            Sign in with Email
          </button>
        </form>

        <p className="text-center text-sm text-text2">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-accent2 hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
