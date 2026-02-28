"use client";

import { useState } from "react";
import type { AgentType } from "@/lib/agents";

type Props = {
  agent: AgentType;
  onStart: (values: Record<string, string>) => void;
  onBack: () => void;
};

export default function AgentSetup({ agent, onStart, onBack }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onStart(values);
  }

  const requiredFilled = agent.fields
    .filter((f) => f.required)
    .every((f) => values[f.id]?.trim());

  return (
    <div className="mx-auto w-full max-w-lg space-y-6 rounded-2xl border border-[#2a2a3d] bg-[#12121a] p-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-[#2a2a3d] px-2 py-1 text-xs text-gray-400 hover:text-white"
        >
          ← Back
        </button>
        <span className="text-2xl">{agent.icon}</span>
        <div>
          <h2 className="text-lg font-semibold text-white">{agent.name}</h2>
          <p className="text-xs text-gray-400">{agent.description}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {agent.fields.map((field) => (
          <div key={field.id}>
            <label className="mb-1 block text-sm font-medium text-gray-300">
              {field.label}
              {field.required && <span className="ml-1 text-[#6c5ce7]">*</span>}
            </label>
            {field.type === "select" ? (
              <select
                value={values[field.id] || ""}
                onChange={(e) => setValues((v) => ({ ...v, [field.id]: e.target.value }))}
                className="w-full rounded-lg border border-[#2a2a3d] bg-[#0d0d15] px-3 py-2 text-sm text-gray-200 focus:border-[#6c5ce7] focus:outline-none"
              >
                <option value="">{field.placeholder}</option>
                {field.options?.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            ) : field.type === "textarea" ? (
              <textarea
                value={values[field.id] || ""}
                onChange={(e) => setValues((v) => ({ ...v, [field.id]: e.target.value }))}
                placeholder={field.placeholder}
                rows={3}
                className="w-full rounded-lg border border-[#2a2a3d] bg-[#0d0d15] px-3 py-2 text-sm text-gray-200 placeholder:text-gray-600 focus:border-[#6c5ce7] focus:outline-none"
              />
            ) : (
              <input
                type="text"
                value={values[field.id] || ""}
                onChange={(e) => setValues((v) => ({ ...v, [field.id]: e.target.value }))}
                placeholder={field.placeholder}
                className="w-full rounded-lg border border-[#2a2a3d] bg-[#0d0d15] px-3 py-2 text-sm text-gray-200 placeholder:text-gray-600 focus:border-[#6c5ce7] focus:outline-none"
              />
            )}
          </div>
        ))}

        <button
          type="submit"
          disabled={!requiredFilled}
          className="w-full rounded-lg bg-[#6c5ce7] px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Start {agent.name} →
        </button>
      </form>
    </div>
  );
}
