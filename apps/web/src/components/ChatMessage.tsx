"use client";

import CodeBlock from "@/components/CodeBlock";

type ChatRole = "user" | "assistant" | "system";

type ChatMessageProps = {
  role: ChatRole;
  content: string;
};

type Segment =
  | { type: "text"; content: string }
  | { type: "code"; content: string; language?: string };

function parseSegments(content: string): Segment[] {
  const segments: Segment[] = [];
  const regex = /```([a-zA-Z0-9_-]+)?\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while (true) {
    match = regex.exec(content);
    if (!match) {
      break;
    }

    if (match.index > lastIndex) {
      segments.push({
        type: "text",
        content: content.slice(lastIndex, match.index),
      });
    }

    segments.push({
      type: "code",
      language: match[1],
      content: match[2].trimEnd(),
    });

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < content.length) {
    segments.push({
      type: "text",
      content: content.slice(lastIndex),
    });
  }

  if (segments.length === 0) {
    return [{ type: "text", content }];
  }

  return segments;
}

export default function ChatMessage({ role, content }: ChatMessageProps) {
  const isUser = role === "user";

  return (
    <div className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm sm:max-w-[80%] ${
          isUser
            ? "rounded-br-md bg-[#6c5ce7] text-white"
            : "rounded-bl-md border border-[#23233a] bg-[#12121a] text-gray-100"
        }`}
      >
        {parseSegments(content).map((segment, index) =>
          segment.type === "code" ? (
            <CodeBlock key={`code-${index}`} code={segment.content} language={segment.language} />
          ) : (
            <p key={`text-${index}`} className="whitespace-pre-wrap break-words">
              {segment.content}
            </p>
          )
        )}
      </div>
    </div>
  );
}
