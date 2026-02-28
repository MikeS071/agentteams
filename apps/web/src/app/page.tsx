import Link from "next/link";

const capabilities = [
  {
    icon: "🔬",
    name: "Research",
    description: "Deep research on any topic",
  },
  {
    icon: "💻",
    name: "Coder",
    description: "Build and deploy applications",
  },
  {
    icon: "🎯",
    name: "Lead Gen",
    description: "Find and qualify prospects",
  },
  {
    icon: "🕵️",
    name: "Intel",
    description: "Monitor competitors and markets",
  },
  {
    icon: "📱",
    name: "Social",
    description: "Manage social media presence",
  },
  {
    icon: "🌐",
    name: "Browser",
    description: "Automate web tasks",
  },
  {
    icon: "🎬",
    name: "Clips",
    description: "Create video content",
  },
  {
    icon: "🔮",
    name: "Predictor",
    description: "Forecast trends and outcomes",
  },
] as const;

export default function HomePage() {
  return (
    <main className="relative isolate overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 -z-10 opacity-40"
        aria-hidden
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(108,92,231,0.20) 1px, transparent 0), linear-gradient(rgba(108,92,231,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(0,206,201,0.08) 1px, transparent 1px)",
          backgroundSize: "22px 22px, 72px 72px, 72px 72px",
          backgroundPosition: "0 0, 0 0, 0 0",
        }}
      />
      <section className="mx-auto flex min-h-[72vh] w-full max-w-6xl flex-col px-6 pb-16 pt-24 sm:px-10 lg:px-16">
        <p className="mb-5 inline-flex w-fit items-center rounded-full border border-accent/30 bg-accent/10 px-4 py-1 text-xs uppercase tracking-[0.24em] text-accent2">
          AgentSquads
        </p>
        <h1 className="max-w-4xl text-4xl font-semibold leading-tight text-text sm:text-5xl md:text-6xl">
          <span className="bg-gradient-to-r from-accent2 via-accent to-accent3 bg-clip-text text-transparent">
            Your AI Team, Ready to Work
          </span>
        </h1>
        <p className="mt-6 max-w-2xl text-base leading-relaxed text-text2 sm:text-lg">
          Spin up AI agents for every task across your team. Research, build,
          prospect, monitor, and ship faster with one unified platform.
        </p>
        <div className="mt-10 flex w-full max-w-xl flex-col gap-4 sm:flex-row">
          <form action="/signup" className="flex w-full flex-1 gap-3">
            <label htmlFor="hero-email" className="sr-only">
              Email
            </label>
            <input
              id="hero-email"
              type="email"
              name="email"
              placeholder="Enter your email to get started"
              className="w-full rounded-xl border border-bg3 bg-bg2 px-4 py-3 text-sm text-text placeholder:text-text2/80 focus:border-accent focus:outline-none"
            />
            <button
              type="submit"
              className="whitespace-nowrap rounded-xl bg-accent px-5 py-3 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:bg-accent2"
            >
              Get Started Free
            </button>
          </form>
        </div>
      </section>

      <section id="capabilities" className="mx-auto w-full max-w-6xl px-6 pb-20 sm:px-10 lg:px-16">
        <h2 className="text-2xl font-semibold text-text sm:text-3xl">
          AI capabilities for every workflow
        </h2>
        <p className="mt-3 max-w-2xl text-text2">
          Choose specialized agents that work independently or together.
        </p>
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {capabilities.map((capability) => (
            <article
              key={capability.name}
              className="group rounded-2xl border border-bg3 bg-bg2/80 p-5 transition duration-200 hover:-translate-y-1 hover:border-accent/50 hover:shadow-[0_10px_35px_rgba(108,92,231,0.22)]"
            >
              <div className="text-2xl transition-transform duration-200 group-hover:scale-110">
                {capability.icon}
              </div>
              <h3 className="mt-4 text-lg font-medium text-text">{capability.name}</h3>
              <p className="mt-2 text-sm text-text2">{capability.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="pricing" className="mx-auto w-full max-w-6xl px-6 pb-24 sm:px-10 lg:px-16">
        <div className="rounded-3xl border border-accent/30 bg-gradient-to-br from-bg2 via-bg2 to-bg3 p-8 sm:p-10">
          <h2 className="text-2xl font-semibold text-text sm:text-3xl">
            Pay only for what you use
          </h2>
          <p className="mt-4 max-w-2xl text-text2">
            No fixed subscriptions. Token-based pricing means you only pay for
            real usage across your agents. Start free, scale when output grows.
          </p>
          <div className="mt-7">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center rounded-xl bg-accent px-6 py-3 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:bg-accent2"
            >
              Get Started Free
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-bg3/80">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-6 py-8 text-sm text-text2 sm:px-10 md:flex-row md:items-center md:justify-between lg:px-16">
          <p>© {new Date().getFullYear()} AgentSquads. All rights reserved.</p>
          <nav className="flex items-center gap-5">
            <a href="#capabilities" className="transition hover:text-text">
              Capabilities
            </a>
            <a href="#pricing" className="transition hover:text-text">
              Pricing
            </a>
            <Link href="/login" className="transition hover:text-text">
              Login
            </Link>
            <Link href="/signup" className="transition hover:text-text">
              Signup
            </Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
