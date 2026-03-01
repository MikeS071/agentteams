import { useMemo } from "react";

type Message = {
  role: "user" | "assistant" | "system";
  content: string;
};

type Props = {
  messages: Message[];
};

const STEPS = ["Plan", "Search", "Read", "Analyze", "Gap Analysis", "Synthesize", "Report"];

function extractSources(messages: Message[]) {
  const links: Array<{ title: string; url: string }> = [];
  const seen = new Set<string>();

  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const re = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(message.content)) !== null) {
      if (!seen.has(match[2])) {
        seen.add(match[2]);
        links.push({ title: match[1], url: match[2] });
      }
    }
  }

  return links.slice(0, 8);
}

export default function ResearchPanel({ messages }: Props) {
  const assistantCount = useMemo(
    () => messages.filter((message) => message.role === "assistant" && message.content.trim()).length,
    [messages]
  );

  const stageIndex = Math.max(0, Math.min(STEPS.length - 1, assistantCount - 1));
  const sources = useMemo(() => extractSources(messages), [messages]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-[#1f1f29] px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-100">Research Panel</h3>
        <p className="text-xs text-gray-400">Live pipeline and source feed</p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <section className="rounded-xl border border-[#242431] bg-[#11111a] p-3">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Pipeline Progress</h4>
          <div className="space-y-2">
            {STEPS.map((step, index) => {
              const status = index < stageIndex ? "done" : index === stageIndex ? "running" : "pending";
              return (
                <div key={step} className="flex items-center justify-between rounded-lg border border-[#21212c] bg-[#0e0e16] px-3 py-2 text-xs">
                  <span className="text-gray-200">{step}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] uppercase ${
                      status === "done"
                        ? "bg-[#163525] text-[#9ff1c5]"
                        : status === "running"
                          ? "bg-[#12293a] text-[#93c5fd]"
                          : "bg-[#24242f] text-gray-400"
                    }`}
                  >
                    {status}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-xl border border-[#242431] bg-[#11111a] p-3">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Gap Analysis</h4>
          <div className="flex flex-wrap gap-2">
            {["Market data", "Primary sources", "Contrarian evidence"].map((gap) => (
              <button
                key={gap}
                type="button"
                className="rounded-lg border border-[#303041] bg-[#151523] px-3 py-1.5 text-xs text-gray-200 hover:border-[#47475e]"
              >
                🔍 {gap}
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-[#242431] bg-[#11111a] p-3">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Sources Feed</h4>
          {sources.length === 0 ? (
            <p className="text-xs text-gray-500">No sources extracted from messages yet.</p>
          ) : (
            <div className="space-y-2">
              {sources.map((source) => (
                <a
                  key={source.url}
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-lg border border-[#232334] bg-[#0e0e16] px-3 py-2 text-xs text-gray-200 hover:border-[#3b4b63]"
                >
                  <p className="truncate font-medium">{source.title}</p>
                  <p className="truncate text-gray-400">{source.url}</p>
                </a>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
