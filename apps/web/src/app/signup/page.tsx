"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";

export default function SignupPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-bg3 bg-bg2 p-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-text">Create your AgentSquads account</h1>
          <p className="mt-2 text-sm text-text2">Start free and launch your AI team</p>
        </div>

        <form className="space-y-4" onSubmit={(event) => event.preventDefault()}>
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium text-text2">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              className="w-full rounded-lg border border-bg3 bg-bg px-3 py-2.5 text-sm text-text outline-none transition-colors focus:border-accent2"
              placeholder="you@company.com"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="text-sm font-medium text-text2">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              className="w-full rounded-lg border border-bg3 bg-bg px-3 py-2.5 text-sm text-text outline-none transition-colors focus:border-accent2"
              placeholder="Create a password"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-lg bg-[#6c5ce7] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#7b6df0]"
          >
            Sign up with Email
          </button>
        </form>

        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-bg3" />
          <span className="text-xs uppercase tracking-wide text-text2">Or continue with</span>
          <div className="h-px flex-1 bg-bg3" />
        </div>

        <div className="space-y-3">
          <button
            onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
            className="flex w-full items-center justify-center gap-3 rounded-lg border border-bg3 bg-bg px-4 py-2.5 font-medium text-text transition-colors hover:bg-bg3"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continue with Google
          </button>

          <button
            type="button"
            disabled
            className="flex w-full items-center justify-center gap-3 rounded-lg border border-bg3 bg-bg px-4 py-2.5 font-medium text-text2"
          >
            Continue with GitHub (Coming Soon)
          </button>
        </div>

        <p className="text-center text-sm text-text2">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-accent2 hover:text-text">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
