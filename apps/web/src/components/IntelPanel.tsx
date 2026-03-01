import { useMemo } from "react";

type Message = {
  role: "user" | "assistant" | "system";
  content: string;
};

type Props = {
  messages: Message[];
};

function extractIntelItems(messages: Message[]) {
  const rows: Array<{ title: string; snippet: string }> = [];

  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const lines = message.content.split("\n").map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      if (line.length < 24) continue;
      rows.push({
        title: line.slice(0, 72),
        snippet: line,
      });
      if (rows.length >= 10) {
        return rows;
      }
    }
  }

  return rows;
}

export default function IntelPanel({ messages }: Props) {
  const items = useMemo(() => extractIntelItems(messages), [messages]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-[#1f1f29] px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-100">Intel Dashboard</h3>
        <p className="text-xs text-gray-400">Signals, risk flags, and timeline</p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <section className="rounded-xl border border-[#242431] bg-[#11111a] p-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Monitoring Target</h4>
          <p className="mt-2 text-sm text-gray-200">Active target context comes from your latest prompt and assistant updates.</p>
        </section>

        <section className="rounded-xl border border-[#242431] bg-[#11111a] p-3">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Intel Feed</h4>
          {items.length === 0 ? (
            <p className="text-xs text-gray-500">No findings yet.</p>
          ) : (
            <div className="space-y-2">
              {items.map((item, index) => (
                <div key={`${item.title}-${index}`} className="rounded-lg border-l-2 border-[#3b82f6] bg-[#0e0e16] px-3 py-2">
                  <p className="text-xs font-medium text-gray-200">{item.title}</p>
                  <p className="mt-1 text-xs text-gray-400 line-clamp-2">{item.snippet}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-[#242431] bg-[#11111a] p-3">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Key Signals</h4>
          <div className="space-y-2 text-xs">
            <p className="rounded-lg border border-[#3a1f1f] bg-[#1a1010] px-3 py-2 text-[#fca5a5]">🔴 High: Track sudden leadership changes.</p>
            <p className="rounded-lg border border-[#3a351c] bg-[#1a1810] px-3 py-2 text-[#fcd34d]">🟡 Medium: Watch hiring velocity shifts.</p>
            <p className="rounded-lg border border-[#1f3a2e] bg-[#0f1a15] px-3 py-2 text-[#86efac]">🟢 Low: Routine announcement cadence.</p>
          </div>
        </section>
      </div>
    </div>
  );
}
