"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

type ChatRole = "user" | "assistant" | "system";

type ChatMessageProps = {
  role: ChatRole;
  content: string;
};

export default function ChatMessage({ role, content }: ChatMessageProps) {
  const isUser = role === "user";

  return (
    <div className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm sm:max-w-[80%] ${
          isUser
            ? "rounded-br-md border border-[#2a2a2e] bg-[#151517] text-[#f5f5f6]"
            : "rounded-bl-md border border-[#23233a] bg-[#0f1013] text-gray-100"
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap break-words">{content}</p>
        ) : (
          <div className="chat-markdown break-words">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={{
                a: ({ href, ...props }) => (
                  <a
                    {...props}
                    href={href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-[#7ad4ff] underline decoration-[#2e7da3] underline-offset-2 hover:text-[#9ce2ff]"
                  />
                ),
              }}
            >
              {content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
