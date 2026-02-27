"use client";

import { useState } from "react";

type ChatInputProps = {
  onSend: (message: string) => Promise<void>;
  disabled?: boolean;
};

export default function ChatInput({ onSend, disabled = false }: ChatInputProps) {
  const [value, setValue] = useState("");

  async function submit() {
    const text = value.trim();
    if (!text || disabled) {
      return;
    }

    setValue("");

    try {
      await onSend(text);
    } catch {
      setValue(text);
    }
  }

  return (
    <div className="border-t border-[#1f1f2f] bg-[#0f0f17] p-3 sm:p-4">
      <div className="mx-auto flex max-w-4xl items-end gap-2 rounded-xl border border-[#2a2a3d] bg-[#141420] p-2">
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder="Send a message..."
          rows={1}
          disabled={disabled}
          className="max-h-36 min-h-[42px] flex-1 resize-y bg-transparent px-2 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none"
        />
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
  );
}
