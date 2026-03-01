import { useMemo } from "react";

type Message = {
  role: "user" | "assistant" | "system";
  content: string;
};

type Props = {
  messages: Message[];
};

function extractDrafts(messages: Message[]) {
  const drafts: string[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const lines = message.content.split("\n").map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      if (line.length >= 28) {
        drafts.push(line);
      }
      if (drafts.length >= 5) {
        return drafts;
      }
    }
  }
  return drafts;
}

export default function SocialPanel({ messages }: Props) {
  const drafts = useMemo(() => extractDrafts(messages), [messages]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-[#1f1f29] px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-100">Social Calendar</h3>
        <p className="text-xs text-gray-400">Pipeline, schedule, and quick actions</p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <section className="rounded-xl border border-[#242431] bg-[#11111a] p-3">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Content Pipeline</h4>
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
            {[
              ["Draft", "bg-[#1b2b45] text-[#93c5fd]"],
              ["QA", "bg-[#2f2512] text-[#fcd34d]"],
              ["Approved", "bg-[#173525] text-[#86efac]"],
              ["Published", "bg-[#263045] text-[#bfdbfe]"],
              ["Scheduled", "bg-[#2c1f45] text-[#d8b4fe]"],
            ].map(([label, style]) => (
              <span key={label} className={`rounded-md px-2 py-1 text-center ${style}`}>
                {label}
              </span>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-[#242431] bg-[#11111a] p-3">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Posting Calendar</h4>
          <div className="grid grid-cols-5 gap-1 text-[10px]">
            {["Mon", "Tue", "Wed", "Thu", "Fri"].map((day) => (
              <div key={day} className="rounded-md border border-[#232334] bg-[#0f0f17] p-2 text-center text-gray-300">
                {day}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-[#242431] bg-[#11111a] p-3">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Draft Extracts</h4>
          {drafts.length === 0 ? (
            <p className="text-xs text-gray-500">Draft snippets will appear as assistant responses arrive.</p>
          ) : (
            <div className="space-y-2">
              {drafts.map((draft, index) => (
                <p key={`${draft}-${index}`} className="rounded-md border border-[#232334] bg-[#0f0f17] px-3 py-2 text-xs text-gray-200 line-clamp-3">
                  {draft}
                </p>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
