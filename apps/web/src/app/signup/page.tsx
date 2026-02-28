"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { FormEvent, useState } from "react";

type SignupResponse = {
  error?: string;
};

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [oauthProvider, setOauthProvider] = useState<"google" | "github" | null>(null);

  async function handleSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Email is required.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: normalizedEmail,
          password,
        }),
      });

      const payload = (await response.json().catch(() => null)) as SignupResponse | null;

      if (!response.ok) {
        setError(payload?.error ?? "Sign up failed.");
        return;
      }

      const signInResult = await signIn("credentials", {
        email: normalizedEmail,
        password,
        callbackUrl: "/dashboard",
        redirect: false,
      });

      if (signInResult?.error) {
        setError("Account created, but auto sign-in failed. Please log in.");
        return;
      }

      window.location.href = signInResult?.url ?? "/dashboard";
    } catch {
      setError("Sign up failed. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleOAuth(provider: "google" | "github") {
    setError(null);
    setOauthProvider(provider);
    void signIn(provider, { callbackUrl: "/dashboard" });
  }

  const busy = isSubmitting || oauthProvider !== null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-12">
      <div className="w-full max-w-sm space-y-6 rounded-2xl border border-bg3 bg-bg2 p-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-text">Create your account</h1>
          <p className="mt-2 text-sm text-text2">Start building with AgentSquads</p>
        </div>

        {error ? (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>
        ) : null}

        <form className="space-y-3" onSubmit={handleSignup}>
          <div className="space-y-1">
            <label htmlFor="email" className="text-sm font-medium text-text2">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-lg border border-bg3 bg-bg px-3 py-2 text-sm text-text outline-none ring-0 transition-colors placeholder:text-text2/70 focus:border-text2"
              placeholder="you@example.com"
              disabled={busy}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="password" className="text-sm font-medium text-text2">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-lg border border-bg3 bg-bg px-3 py-2 text-sm text-text outline-none ring-0 transition-colors placeholder:text-text2/70 focus:border-text2"
              placeholder="At least 8 characters"
              disabled={busy}
            />
            <p className="text-xs text-text2">Password must be at least 8 characters.</p>
          </div>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmitting ? "Creating account..." : "Sign up with Email"}
          </button>
        </form>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-bg3" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-bg2 px-2 text-text2">or continue with</span>
          </div>
        </div>

        <div className="space-y-2">
          <button
            onClick={() => handleOAuth("google")}
            disabled={busy}
            className="flex w-full items-center justify-center gap-3 rounded-lg border border-bg3 bg-bg px-4 py-2.5 text-sm font-medium text-text transition-colors hover:bg-bg3 disabled:cursor-not-allowed disabled:opacity-70"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Sign up with Google
          </button>

          <button
            onClick={() => handleOAuth("github")}
            disabled={busy}
            className="flex w-full items-center justify-center gap-3 rounded-lg border border-bg3 bg-bg px-4 py-2.5 text-sm font-medium text-text transition-colors hover:bg-bg3 disabled:cursor-not-allowed disabled:opacity-70"
          >
            <svg className="h-5 w-5 fill-current" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.42-4.04-1.42-.55-1.38-1.33-1.75-1.33-1.75-1.09-.74.08-.72.08-.72 1.2.08 1.83 1.2 1.83 1.2 1.08 1.8 2.83 1.29 3.52.99.11-.76.42-1.29.76-1.58-2.67-.29-5.47-1.31-5.47-5.84 0-1.29.47-2.35 1.23-3.18-.13-.29-.53-1.48.12-3.08 0 0 1-.32 3.3 1.21A11.62 11.62 0 0 1 12 6.53a11.7 11.7 0 0 1 3.01.4c2.3-1.53 3.3-1.21 3.3-1.21.65 1.6.25 2.79.12 3.08.77.83 1.23 1.89 1.23 3.18 0 4.54-2.8 5.55-5.48 5.84.43.37.82 1.1.82 2.22v3.29c0 .32.22.69.83.58A12 12 0 0 0 12 .5" />
            </svg>
            Sign up with GitHub
          </button>
        </div>

        <p className="text-center text-sm text-text2">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-text underline underline-offset-2">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
