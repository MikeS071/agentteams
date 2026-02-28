"use client";

import { useEffect, useState } from "react";

type Model = { id: string; name: string; provider: string };

type ChatInputProps = {
  onSend: (message: string, model?: string) => Promise<void>;
  disabled?: boolean;
};

export default function ChatInput({ onSend, disabled = false }: ChatInputProps) {
  const [value, setValue] = useState("");
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState("");

  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((d: { models: Model[] }) => {
        setModels(d.models || []);
        if (d.models?.length && !selectedModel) {
          setSelectedModel(d.models[0].id);
        }
      })
      .catch(() => {});
  }, []);

  async function submit() {
    const text = value.trim();
    if (!text || disabled) return;
    setValue("");
    try {
      await onSend(text, selectedModel || undefined);
    } catch {
      setValue(text);
    }
  }

  return (
    <div className="border-t border-[#1f1f2f] bg-[#0f0f17] p-3 sm:p-4">
      <div className="mx-auto flex max-w-4xl flex-col gap-2">
        <div className="flex items-end gap-2 rounded-xl border border-[#2a2a3d] bg-[#141420] p-2">
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="Send a message..."
            rows={1}
            disabled={disabled}
            className="max-h-36 min-h-[42px] flex-1 resize-y bg-transparent px-2 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none"
          />
          <div className="flex items-center gap-2">
            {models.length > 0 && (
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="h-9 rounded-lg border border-[#2a2a3d] bg-[#0d0d15] px-2 text-xs text-gray-300 focus:border-[#6c5ce7] focus:outline-none"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={() => void submit()}
              disabled={disabled || value.trim().length === 0}
              className="rounded-lg bg-[#6c5ce7] px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
