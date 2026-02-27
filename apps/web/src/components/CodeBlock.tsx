"use client";

import { useState } from "react";
import SyntaxHighlighter from "react-syntax-highlighter";
import { atomOneDark } from "react-syntax-highlighter/dist/esm/styles/hljs";

type CodeBlockProps = {
  code: string;
  language?: string;
};

export default function CodeBlock({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="relative my-3 overflow-hidden rounded-lg border border-[#2a2a3d] bg-[#11111a]">
      <div className="flex items-center justify-between border-b border-[#2a2a3d] px-3 py-2 text-xs text-gray-400">
        <span>{language || "code"}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="rounded bg-[#1a1a2e] px-2 py-1 text-[11px] text-gray-200 hover:bg-[#23233a]"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <SyntaxHighlighter
        language={language || "plaintext"}
        style={atomOneDark}
        customStyle={{
          margin: 0,
          background: "#11111a",
          padding: "0.9rem",
          fontSize: "0.84rem",
          lineHeight: "1.45",
        }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
