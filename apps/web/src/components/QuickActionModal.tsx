"use client";

import { useEffect, useMemo, useState } from "react";
import type { QuickAction } from "@/lib/quick-actions";

type Props = {
  action: QuickAction | null;
  onClose: () => void;
  onSubmit: (prompt: string) => void;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default function QuickActionModal({ action, onClose, onSubmit }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!action) {
      setValues({});
      setErrors({});
      return;
    }

    const initialValues: Record<string, string> = {};
    for (const field of action.fields) {
      initialValues[field.id] = "";
    }
    setValues(initialValues);
    setErrors({});
  }, [action]);

  useEffect(() => {
    if (!action) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [action, onClose]);

  const title = useMemo(() => action?.label ?? "", [action]);

  if (!action) {
    return null;
  }

  function handleStart() {
    if (!action) {
      return;
    }

    const nextErrors: Record<string, string> = {};

    for (const field of action.fields) {
      const value = values[field.id]?.trim() ?? "";
      if (field.required && !value) {
        nextErrors[field.id] = `${field.label} is required`;
      }
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    let prompt = action.promptTemplate;
    for (const field of action.fields) {
      const token = new RegExp(`{{\\s*${escapeRegExp(field.id)}\\s*}}`, "g");
      prompt = prompt.replace(token, values[field.id]?.trim() ?? "");
    }

    onSubmit(prompt);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        aria-label="Close quick action modal"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />

      <div className="relative z-10 w-full max-w-lg rounded-2xl border border-[#24242c] bg-[#14141a] p-5 shadow-2xl">
        <h2 className="text-lg font-semibold text-gray-100">{action.label}</h2>

        <div className="mt-4 space-y-4">
          {action.fields.map((field) => (
            <label key={field.id} className="block space-y-1.5">
              <span className="text-sm text-gray-200">
                {field.label}
                {field.required ? " *" : ""}
              </span>

              {field.type === "textarea" ? (
                <textarea
                  value={values[field.id] ?? ""}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setValues((prev) => ({ ...prev, [field.id]: nextValue }));
                    setErrors((prev) => ({ ...prev, [field.id]: "" }));
                  }}
                  placeholder={field.placeholder}
                  rows={4}
                  className="w-full rounded-lg border border-[#2b2b36] bg-[#0f1016] px-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:border-[#3a3a44] focus:outline-none"
                />
              ) : field.type === "select" ? (
                <select
                  value={values[field.id] ?? ""}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setValues((prev) => ({ ...prev, [field.id]: nextValue }));
                    setErrors((prev) => ({ ...prev, [field.id]: "" }));
                  }}
                  className="w-full rounded-lg border border-[#2b2b36] bg-[#0f1016] px-3 py-2 text-sm text-gray-100 focus:border-[#3a3a44] focus:outline-none"
                >
                  <option value="">{field.placeholder}</option>
                  {(field.options ?? []).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={values[field.id] ?? ""}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setValues((prev) => ({ ...prev, [field.id]: nextValue }));
                    setErrors((prev) => ({ ...prev, [field.id]: "" }));
                  }}
                  placeholder={field.placeholder}
                  className="w-full rounded-lg border border-[#2b2b36] bg-[#0f1016] px-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:border-[#3a3a44] focus:outline-none"
                />
              )}

              {errors[field.id] ? <p className="text-xs text-red-400">{errors[field.id]}</p> : null}
            </label>
          ))}
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[#2b2b36] px-3 py-1.5 text-sm text-gray-300 hover:border-[#3a3a44] hover:bg-[#131320]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleStart}
            className="rounded-lg border border-[#24402f] bg-[#123423] px-3 py-1.5 text-sm text-[#c8ffe2] hover:bg-[#17462f]"
          >
            Start
          </button>
        </div>
      </div>
    </div>
  );
}
