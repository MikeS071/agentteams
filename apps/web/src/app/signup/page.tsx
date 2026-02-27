"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import Link from "next/link";

export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name }),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Signup failed");
      return;
    }

    await signIn("credentials", { email, password, callbackUrl: "/dashboard/chat" });
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md space-y-6 rounded-xl border border-bg3 bg-bg2 p-8">
        <h1 className="text-center text-2xl font-bold text-text">Create your account</h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="text-sm text-red-400">{error}</p>}
          <input
            type="text"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-bg3 bg-bg px-4 py-2.5 text-text placeholder-text2 focus:border-accent focus:outline-none"
          />
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
            minLength={8}
          />
          <button
            type="submit"
            className="w-full rounded-lg bg-accent px-4 py-2.5 font-medium text-white transition-opacity hover:opacity-90"
          >
            Create Account
          </button>
        </form>

        <p className="text-center text-sm text-text2">
          Already have an account?{" "}
          <Link href="/login" className="text-accent2 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
