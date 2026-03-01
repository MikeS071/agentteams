"use client";

import { useEffect, useMemo, useState } from "react";
import type { QuickAction } from "@/lib/quick-actions";

type Props = {
  action: QuickAction | null;
  open: boolean;
  onSubmit: (prompt: string) => void;
  onClose: () => void;
};

function renderPrompt(template: string, values: Record<string, string>): string {
  const normalized: Record<string, string> = {};
  Object.entries(values).forEach(([key, value]) => {
    normalized[key] = value.trim();
  });

  let prompt = template.replace(/{{#(\w+)}}([\s\S]*?){{\/\1}}/g, (_, fieldId: string, content: string) => {
    const value = normalized[fieldId];
    if (!value) {
      return "";
    }
    return content.replace(new RegExp(`{{${fieldId}}}`, "g"), value);
  });

  prompt = prompt.replace(/{{(\w+)}}/g, (_, fieldId: string) => normalized[fieldId] ?? "");
  return prompt.replace(/\n{3,}/g, "\n\n").trim();
}

export default function QuickActionModal({ action, open, onSubmit, onClose }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!action || !open) {
      return;
    }
    const initialValues = action.fields.reduce<Record<string, string>>((acc, field) => {
      acc[field.id] = "";
      return acc;
    }, {});
    setValues(initialValues);
  }, [action, open]);

  const hasMissingRequired = useMemo(() => {
    if (!action) {
      return true;
    }
    return action.fields.some((field) => field.required && !values[field.id]?.trim());
  }, [action, values]);

  if (!action || !open) {
    return null;
  }
  const selectedAction = action;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = renderPrompt(selectedAction.promptTemplate, values);
    onSubmit(prompt);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-[#24242c] bg-[#14141a] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#24242c] px-4 py-3">
          <h2 className="text-base font-semibold text-gray-100">
            {selectedAction.icon ? `${selectedAction.icon} ` : ""}
            {selectedAction.label}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[#2d2d36] px-2.5 py-1 text-xs text-gray-300 hover:bg-[#1a1a22]"
          >
            Cancel
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-4">
          {selectedAction.fields.map((field) => (
            <div key={field.id} className="space-y-1">
              <label className="block text-sm font-medium text-gray-200">
                {field.label}
                {field.required ? " *" : ""}
              </label>
              {field.type === "textarea" ? (
                <textarea
                  value={values[field.id] ?? ""}
                  placeholder={field.placeholder}
                  onChange={(event) =>
                    setValues((prev) => ({
                      ...prev,
                      [field.id]: event.target.value,
                    }))
                  }
                  rows={4}
                  className="w-full rounded-lg border border-[#2b2b35] bg-[#101017] px-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:border-[#3a3a44] focus:outline-none"
                />
              ) : field.type === "select" ? (
                <select
                  value={values[field.id] ?? ""}
                  onChange={(event) =>
                    setValues((prev) => ({
                      ...prev,
                      [field.id]: event.target.value,
                    }))
                  }
                  className="w-full rounded-lg border border-[#2b2b35] bg-[#101017] px-3 py-2 text-sm text-gray-100 focus:border-[#3a3a44] focus:outline-none"
                >
                  <option value="">{field.placeholder}</option>
                  {field.options?.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={values[field.id] ?? ""}
                  placeholder={field.placeholder}
                  onChange={(event) =>
                    setValues((prev) => ({
                      ...prev,
                      [field.id]: event.target.value,
                    }))
                  }
                  className="w-full rounded-lg border border-[#2b2b35] bg-[#101017] px-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:border-[#3a3a44] focus:outline-none"
                />
              )}
            </div>
          ))}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#2d2d37] px-3 py-1.5 text-sm text-gray-300 hover:bg-[#1a1a22]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={hasMissingRequired}
              className="rounded-lg border border-[#24242c] bg-[#1f8f5f] px-3 py-1.5 text-sm text-white hover:bg-[#17784f] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Start
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
