"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { WorkflowStepType, WorkflowTemplate, WorkflowTemplateStep } from "./template-types";

type BuilderMode = "new" | "edit";

type TemplateBuilderProps = {
  mode: BuilderMode;
  templateID?: string;
};

const stepTypeOptions: WorkflowStepType[] = ["action", "confirm", "condition"];

const emptyStep = (): WorkflowTemplateStep => ({
  name: "",
  type: "action",
  description: "",
  actionCommand: "",
});

const emptyTemplate: WorkflowTemplate = {
  id: "",
  name: "",
  description: "",
  isStarter: false,
  steps: [emptyStep()],
};

function slugify(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function generateTOML(template: WorkflowTemplate): string {
  const lines: string[] = [];
  const id = template.id || slugify(template.name);

  lines.push(`id = "${id}"`);
  lines.push(`name = "${template.name.replaceAll('"', '\\"')}"`);
  lines.push(`description = "${template.description.replaceAll('"', '\\"')}"`);
  lines.push("");

  template.steps.forEach((step) => {
    lines.push("[[steps]]");
    lines.push(`name = "${step.name.replaceAll('"', '\\"')}"`);
    lines.push(`type = "${step.type}"`);
    lines.push(`description = "${step.description.replaceAll('"', '\\"')}"`);
    lines.push(`action_command = "${step.actionCommand.replaceAll('"', '\\"')}"`);
    lines.push("");
  });

  return lines.join("\n").trimEnd();
}

export default function TemplateBuilder({ mode, templateID }: TemplateBuilderProps) {
  const router = useRouter();
  const [template, setTemplate] = useState<WorkflowTemplate>(emptyTemplate);
  const [loading, setLoading] = useState(mode === "edit");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "edit" || !templateID) {
      return;
    }

    const loadTemplate = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/workflows/templates/${encodeURIComponent(templateID)}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          const payload = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(payload?.error || "Failed to load template");
        }
        const payload = (await res.json()) as { template: WorkflowTemplate };
        setTemplate(payload.template);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load template");
      } finally {
        setLoading(false);
      }
    };

    void loadTemplate();
  }, [mode, templateID]);

  const tomlPreview = useMemo(() => generateTOML(template), [template]);

  const updateTemplateField = (field: keyof WorkflowTemplate, value: string) => {
    setTemplate((current) => {
      const next: WorkflowTemplate = { ...current, [field]: value };
      if (field === "name" && mode === "new") {
        next.id = slugify(value);
      }
      return next;
    });
  };

  const updateStep = (index: number, field: keyof WorkflowTemplateStep, value: string) => {
    setTemplate((current) => {
      const nextSteps = current.steps.map((step, idx) =>
        idx === index ? { ...step, [field]: value } : step
      );
      return { ...current, steps: nextSteps };
    });
  };

  const addStep = () => {
    setTemplate((current) => ({ ...current, steps: [...current.steps, emptyStep()] }));
  };

  const removeStep = (index: number) => {
    setTemplate((current) => {
      if (current.steps.length <= 1) {
        return current;
      }
      return { ...current, steps: current.steps.filter((_, idx) => idx !== index) };
    });
  };

  const moveStep = (index: number, direction: -1 | 1) => {
    setTemplate((current) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.steps.length) {
        return current;
      }
      const nextSteps = [...current.steps];
      [nextSteps[index], nextSteps[nextIndex]] = [nextSteps[nextIndex], nextSteps[index]];
      return { ...current, steps: nextSteps };
    });
  };

  const saveTemplate = async () => {
    setSaving(true);
    setError(null);
    setSaveMessage(null);

    try {
      const payload = {
        ...template,
        id: template.id || slugify(template.name),
      };

      const res = await fetch("/api/workflows/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || "Failed to save template");
      }

      const body = (await res.json()) as { template: WorkflowTemplate };
      setTemplate(body.template);
      setSaveMessage("Template saved.");

      if (mode === "new") {
        router.replace(`/dashboard/workflows/templates/${body.template.id}/edit`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save template");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-sm text-gray-400">Loading template...</div>;
  }

  return (
    <div className="h-full overflow-y-auto p-6 sm:p-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-100">
              {mode === "new" ? "New Workflow Template" : "Edit Workflow Template"}
            </h1>
            <p className="mt-1 text-sm text-gray-400">Build steps sequentially and preview generated TOML.</p>
          </div>
          <Link href="/dashboard/workflows" className="rounded-md border border-[#2b2b42] px-3 py-2 text-sm text-gray-300 hover:bg-[#151526]">
            Back to catalog
          </Link>
        </div>

        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <section className="rounded-xl border border-[#232338] bg-[#0f0f19] p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm text-gray-300 sm:col-span-2">
                Template name
                <input
                  className="rounded-md border border-[#2b2b42] bg-[#101024] px-3 py-2 text-sm text-gray-100 outline-none focus:border-[#5a7dfa]"
                  value={template.name}
                  onChange={(event) => updateTemplateField("name", event.target.value)}
                  placeholder="Customer onboarding flow"
                />
              </label>

              <label className="flex flex-col gap-2 text-sm text-gray-300">
                Template ID
                <input
                  className="rounded-md border border-[#2b2b42] bg-[#101024] px-3 py-2 text-sm text-gray-100 outline-none focus:border-[#5a7dfa]"
                  value={template.id}
                  onChange={(event) => updateTemplateField("id", slugify(event.target.value))}
                  placeholder="customer-onboarding-flow"
                />
              </label>

              <label className="flex flex-col gap-2 text-sm text-gray-300">
                Total steps
                <div className="rounded-md border border-[#2b2b42] bg-[#101024] px-3 py-2 text-sm text-gray-200">{template.steps.length}</div>
              </label>

              <label className="flex flex-col gap-2 text-sm text-gray-300 sm:col-span-2">
                Description
                <textarea
                  className="min-h-20 rounded-md border border-[#2b2b42] bg-[#101024] px-3 py-2 text-sm text-gray-100 outline-none focus:border-[#5a7dfa]"
                  value={template.description}
                  onChange={(event) => updateTemplateField("description", event.target.value)}
                  placeholder="Describe what this workflow automates"
                />
              </label>
            </div>

            <div className="mt-6 flex items-center justify-between">
              <h2 className="text-lg font-medium text-gray-100">Steps</h2>
              <button
                type="button"
                className="rounded-md bg-[#2f4fcf] px-3 py-2 text-sm font-medium text-white hover:bg-[#3a5ae3]"
                onClick={addStep}
              >
                Add Step
              </button>
            </div>

            <div className="mt-4 space-y-4">
              {template.steps.map((step, index) => (
                <article key={`${index}-${step.name}`} className="rounded-lg border border-[#2b2b42] bg-[#121226] p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-200">Step {index + 1}</h3>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="rounded border border-[#2b2b42] px-2 py-1 text-xs text-gray-300 hover:bg-[#1a1a31]"
                        onClick={() => moveStep(index, -1)}
                        disabled={index === 0}
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        className="rounded border border-[#2b2b42] px-2 py-1 text-xs text-gray-300 hover:bg-[#1a1a31]"
                        onClick={() => moveStep(index, 1)}
                        disabled={index === template.steps.length - 1}
                      >
                        Down
                      </button>
                      <button
                        type="button"
                        className="rounded border border-[#4a2b3a] px-2 py-1 text-xs text-[#f2b8d0] hover:bg-[#2a1721]"
                        onClick={() => removeStep(index)}
                        disabled={template.steps.length === 1}
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="flex flex-col gap-2 text-xs uppercase tracking-wide text-gray-400">
                      Name
                      <input
                        className="rounded-md border border-[#2b2b42] bg-[#101024] px-3 py-2 text-sm normal-case text-gray-100 outline-none focus:border-[#5a7dfa]"
                        value={step.name}
                        onChange={(event) => updateStep(index, "name", event.target.value)}
                        placeholder="Run static checks"
                      />
                    </label>

                    <label className="flex flex-col gap-2 text-xs uppercase tracking-wide text-gray-400">
                      Type
                      <select
                        className="rounded-md border border-[#2b2b42] bg-[#101024] px-3 py-2 text-sm normal-case text-gray-100 outline-none focus:border-[#5a7dfa]"
                        value={step.type}
                        onChange={(event) => updateStep(index, "type", event.target.value as WorkflowStepType)}
                      >
                        {stepTypeOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="flex flex-col gap-2 text-xs uppercase tracking-wide text-gray-400 sm:col-span-2">
                      Description
                      <textarea
                        className="min-h-20 rounded-md border border-[#2b2b42] bg-[#101024] px-3 py-2 text-sm normal-case text-gray-100 outline-none focus:border-[#5a7dfa]"
                        value={step.description}
                        onChange={(event) => updateStep(index, "description", event.target.value)}
                        placeholder="Explain what this step does"
                      />
                    </label>

                    <label className="flex flex-col gap-2 text-xs uppercase tracking-wide text-gray-400 sm:col-span-2">
                      Action command
                      <input
                        className="rounded-md border border-[#2b2b42] bg-[#101024] px-3 py-2 text-sm normal-case text-gray-100 outline-none focus:border-[#5a7dfa]"
                        value={step.actionCommand}
                        onChange={(event) => updateStep(index, "actionCommand", event.target.value)}
                        placeholder="run_static_checks"
                      />
                    </label>
                  </div>
                </article>
              ))}
            </div>

            <div className="mt-5 flex items-center gap-3">
              <button
                type="button"
                onClick={saveTemplate}
                disabled={saving}
                className="rounded-md bg-[#2f4fcf] px-4 py-2 text-sm font-medium text-white hover:bg-[#3a5ae3] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Saving..." : "Save template"}
              </button>
              {saveMessage ? <p className="text-sm text-emerald-300">{saveMessage}</p> : null}
              {error ? <p className="text-sm text-rose-300">{error}</p> : null}
            </div>
          </section>

          <section className="rounded-xl border border-[#232338] bg-[#0f0f19] p-5">
            <h2 className="text-lg font-medium text-gray-100">TOML Preview</h2>
            <p className="mt-1 text-sm text-gray-400">Generated from the current builder state.</p>
            <pre className="mt-4 max-h-[70vh] overflow-auto rounded-md border border-[#2b2b42] bg-[#0a0a14] p-4 text-xs text-gray-200">
              {tomlPreview}
            </pre>
          </section>
        </div>
      </div>
    </div>
  );
}
