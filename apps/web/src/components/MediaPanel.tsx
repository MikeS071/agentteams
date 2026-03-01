import { useMemo } from "react";

type Message = {
  role: "user" | "assistant" | "system";
  content: string;
};

type Props = {
  messages: Message[];
};

function extractMediaUrls(messages: Message[]) {
  const urls: string[] = [];
  const seen = new Set<string>();
  const re = /(https?:\/\/\S+\.(?:mp4|webm|gif|png|jpg|jpeg))/gi;

  for (const message of messages) {
    if (message.role !== "assistant") continue;
    let match: RegExpExecArray | null;
    while ((match = re.exec(message.content)) !== null) {
      const url = match[1];
      if (!seen.has(url)) {
        seen.add(url);
        urls.push(url);
      }
      if (urls.length >= 8) {
        return urls;
      }
    }
  }

  return urls;
}

export default function MediaPanel({ messages }: Props) {
  const media = useMemo(() => extractMediaUrls(messages), [messages]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-[#1f1f29] px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-100">Media Panel</h3>
        <p className="text-xs text-gray-400">Preview, storyboard, and export options</p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <section className="rounded-xl border border-[#242431] bg-[#11111a] p-3">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Preview Area</h4>
          <div className="flex h-40 items-center justify-center rounded-lg border border-[#242436] bg-[#0d0d14] text-xs text-gray-500">
            Preview appears when media URLs are returned in assistant output.
          </div>
        </section>

        <section className="rounded-xl border border-[#242431] bg-[#11111a] p-3">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Timeline / Storyboard</h4>
          <div className="flex gap-2 overflow-x-auto">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-14 w-20 shrink-0 rounded-md border border-[#2a2a3a] bg-[#0f0f17]" />
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-[#242431] bg-[#11111a] p-3">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Clip Library</h4>
          {media.length === 0 ? (
            <p className="text-xs text-gray-500">No generated clip links yet.</p>
          ) : (
            <div className="space-y-2">
              {media.map((url) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate rounded-md border border-[#232334] bg-[#0f0f17] px-3 py-2 text-xs text-gray-200 hover:border-[#3b4b63]"
                >
                  {url}
                </a>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
