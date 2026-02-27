"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { WorkflowTemplate } from "./template-types";

type Tab = "starter" | "my";

export default function TemplateCatalog() {
  const [tab, setTab] = useState<Tab>("starter");
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadTemplates = async () => {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/workflows/templates", { cache: "no-store" });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error || "Failed to load templates");
        }

        const payload = (await res.json()) as { templates: WorkflowTemplate[] };
        setTemplates(payload.templates ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load templates");
      } finally {
        setLoading(false);
      }
    };

    void loadTemplates();
  }, []);

  const starterTemplates = useMemo(() => templates.filter((template) => template.isStarter), [templates]);
  const myTemplates = useMemo(() => templates.filter((template) => !template.isStarter), [templates]);
  const visibleTemplates = tab === "starter" ? starterTemplates : myTemplates;

  return (
    <div className="h-full overflow-y-auto p-6 sm:p-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-gray-100">Workflow Catalog</h1>
            <p className="mt-1 text-sm text-gray-400">Choose starter templates or build your own workflow templates.</p>
          </div>
          <Link href="/dashboard/workflows/templates/new" className="rounded-md bg-[#2f4fcf] px-4 py-2 text-sm font-medium text-white hover:bg-[#3a5ae3]">
            New Template
          </Link>
        </div>

        <div className="flex gap-2">
          <button
            className={`rounded-md px-3 py-2 text-sm ${tab === "starter" ? "bg-[#1c2a66] text-white" : "border border-[#2b2b42] text-gray-300 hover:bg-[#141424]"}`}
            onClick={() => setTab("starter")}
          >
            Starter Templates ({starterTemplates.length})
          </button>
          <button
            className={`rounded-md px-3 py-2 text-sm ${tab === "my" ? "bg-[#1c2a66] text-white" : "border border-[#2b2b42] text-gray-300 hover:bg-[#141424]"}`}
            onClick={() => setTab("my")}
          >
            My Templates ({myTemplates.length})
          </button>
        </div>

        {loading ? <div className="text-sm text-gray-400">Loading templates...</div> : null}
        {error ? <div className="text-sm text-rose-300">{error}</div> : null}

        {!loading && !error ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visibleTemplates.map((template) => (
              <article key={template.id} className="rounded-xl border border-[#232338] bg-[#0f0f19] p-4">
                <h2 className="text-base font-semibold text-gray-100">{template.name}</h2>
                <p className="mt-2 line-clamp-3 text-sm text-gray-400">{template.description || "No description"}</p>
                <p className="mt-3 text-xs uppercase tracking-wide text-gray-500">{template.steps.length} steps</p>
                <div className="mt-4 flex items-center justify-between">
                  <code className="rounded bg-[#141429] px-2 py-1 text-xs text-gray-300">{template.id}</code>
                  <Link
                    href={`/dashboard/workflows/templates/${template.id}/edit`}
                    className="rounded-md border border-[#2b2b42] px-3 py-1.5 text-xs text-gray-200 hover:bg-[#16162a]"
                  >
                    Edit
                  </Link>
                </div>
              </article>
            ))}
            {visibleTemplates.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#2b2b42] bg-[#0f0f19] p-6 text-sm text-gray-400">
                {tab === "my" ? "No saved templates yet." : "No starter templates found."}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
