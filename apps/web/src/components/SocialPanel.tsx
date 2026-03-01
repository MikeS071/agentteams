"use client";

import { Fragment, useEffect, useMemo, useState } from "react";

const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;
const PIPELINE_FLOW = ["Draft", "QA", "Approved", "Published", "Scheduled"] as const;
const QUICK_ACTIONS = ["Draft Post", "Schedule", "View Analytics"] as const;

type WeekDay = (typeof WEEK_DAYS)[number];
type PipelineStatus = (typeof PIPELINE_FLOW)[number];
type QuickAction = (typeof QUICK_ACTIONS)[number];
type Platform = "X" | "LinkedIn";

type ContentItem = {
  id: string;
  title: string;
  platforms: Platform[];
  status: PipelineStatus;
};

type CalendarPost = {
  id: string;
  title: string;
  platform: Platform;
  day: WeekDay;
  time: string;
  status: PipelineStatus;
};

type AccountStatus = "Connected" | "Syncing" | "Error";

type SocialAccount = {
  id: string;
  name: string;
  handle: string;
  status: AccountStatus;
};

type SocialData = {
  pipeline: ContentItem[];
  schedule: CalendarPost[];
  accounts: SocialAccount[];
};

type SocialPanelProps = {
  assistantMessages: string[];
  onQuickAction?: (action: QuickAction) => void;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeStatus(value: unknown): PipelineStatus | null {
  if (typeof value !== "string") {
    return null;
  }

  const lower = value.trim().toLowerCase();
  if (!lower) {
    return null;
  }
  if (lower.includes("draft")) {
    return "Draft";
  }
  if (lower === "qa" || lower.includes("review") || lower.includes("quality")) {
    return "QA";
  }
  if (lower.includes("approved")) {
    return "Approved";
  }
  if (lower.includes("published") || lower.includes("posted") || lower.includes("live")) {
    return "Published";
  }
  if (lower.includes("scheduled") || lower.includes("queue")) {
    return "Scheduled";
  }
  return null;
}

function normalizeAccountStatus(value: unknown): AccountStatus {
  if (typeof value !== "string") {
    return "Connected";
  }

  const lower = value.trim().toLowerCase();
  if (lower.includes("error") || lower.includes("fail") || lower.includes("disconnected")) {
    return "Error";
  }
  if (lower.includes("sync") || lower.includes("pending")) {
    return "Syncing";
  }
  return "Connected";
}

function normalizePlatforms(value: unknown): Platform[] {
  const source = Array.isArray(value) ? value : [value];
  const platforms = new Set<Platform>();

  for (const entry of source) {
    if (typeof entry !== "string") {
      continue;
    }
    const lower = entry.toLowerCase();
    if (lower.includes("linkedin")) {
      platforms.add("LinkedIn");
    }
    if (/(^|[^a-z])(x|twitter)([^a-z]|$)/.test(lower)) {
      platforms.add("X");
    }
  }

  return Array.from(platforms);
}

function normalizeDay(value: unknown): WeekDay | null {
  if (typeof value !== "string") {
    return null;
  }

  const lower = value.trim().toLowerCase();
  if (!lower) {
    return null;
  }

  if (lower.startsWith("mon")) return "Mon";
  if (lower.startsWith("tue")) return "Tue";
  if (lower.startsWith("wed")) return "Wed";
  if (lower.startsWith("thu")) return "Thu";
  if (lower.startsWith("fri")) return "Fri";

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  const day = parsedDate.getDay();
  if (day === 1) return "Mon";
  if (day === 2) return "Tue";
  if (day === 3) return "Wed";
  if (day === 4) return "Thu";
  if (day === 5) return "Fri";
  return null;
}

function normalizeTime(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const input = value.trim().toLowerCase();
  if (!input) {
    return null;
  }

  const twelveHourMatch = input.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (twelveHourMatch) {
    const rawHour = Number.parseInt(twelveHourMatch[1], 10);
    const minute = twelveHourMatch[2] ?? "00";
    const meridiem = twelveHourMatch[3];
    if (rawHour < 1 || rawHour > 12) {
      return null;
    }
    let hour = rawHour % 12;
    if (meridiem === "pm") {
      hour += 12;
    }
    return `${String(hour).padStart(2, "0")}:${minute}`;
  }

  const twentyFourHourMatch = input.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (twentyFourHourMatch) {
    const hour = Number.parseInt(twentyFourHourMatch[1], 10);
    const minute = twentyFourHourMatch[2] ?? "00";
    if (hour < 0 || hour > 23) {
      return null;
    }
    return `${String(hour).padStart(2, "0")}:${minute}`;
  }

  return null;
}

function getJsonObjectsFromText(content: string): unknown[] {
  const parsed: unknown[] = [];
  const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null = null;

  while ((match = fencePattern.exec(content))) {
    const candidate = match[1].trim();
    if (!candidate) {
      continue;
    }
    try {
      parsed.push(JSON.parse(candidate) as unknown);
    } catch {
      // Ignore non-JSON code blocks.
    }
  }

  const trimmed = content.trim();
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      parsed.push(JSON.parse(trimmed) as unknown);
    } catch {
      // Ignore non-JSON message payloads.
    }
  }

  return parsed;
}

function parseContentItem(input: unknown, fallbackId: string): ContentItem | null {
  if (typeof input === "string") {
    const status = normalizeStatus(input);
    if (!status) {
      return null;
    }

    const title = input
      .replace(/\b(draft|qa|approved|published|scheduled)\b/gi, "")
      .replace(/\b(linkedin|twitter|x)\b/gi, "")
      .replace(/^[\s\-:|()[\]]+|[\s\-:|()[\]]+$/g, "")
      .trim();

    if (!title) {
      return null;
    }

    const platforms = normalizePlatforms(input);
    return {
      id: fallbackId,
      title,
      status,
      platforms: platforms.length > 0 ? platforms : ["X", "LinkedIn"],
    };
  }

  const record = asRecord(input);
  if (!record) {
    return null;
  }

  const titleValue = [record.title, record.name, record.post, record.content].find((value) => typeof value === "string");
  const status = normalizeStatus(record.status ?? record.stage ?? record.state);
  if (typeof titleValue !== "string" || !status) {
    return null;
  }

  const platforms = normalizePlatforms(record.platforms ?? record.platform ?? record.channels ?? record.channel);
  return {
    id: fallbackId,
    title: titleValue.trim(),
    status,
    platforms: platforms.length > 0 ? platforms : ["X", "LinkedIn"],
  };
}

function parseCalendarPost(input: unknown, fallbackId: string): CalendarPost | null {
  if (typeof input === "string") {
    const dayMatch = input.match(/\b(mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?)\b/i);
    const timeMatch = input.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i);
    if (!dayMatch || !timeMatch) {
      return null;
    }

    const day = normalizeDay(dayMatch[1]);
    const time = normalizeTime(timeMatch[1]);
    if (!day || !time) {
      return null;
    }

    const platforms = normalizePlatforms(input);
    const title = input.split(/[-|]/).pop()?.trim() || "Scheduled post";
    return {
      id: fallbackId,
      title,
      platform: platforms[0] ?? "X",
      day,
      time,
      status: normalizeStatus(input) ?? "Scheduled",
    };
  }

  const record = asRecord(input);
  if (!record) {
    return null;
  }

  const day = normalizeDay(record.day ?? record.weekday ?? record.date);
  const time = normalizeTime(record.time ?? record.slot ?? record.at);
  const titleValue = [record.title, record.name, record.post, record.content].find((value) => typeof value === "string");
  if (!day || !time || typeof titleValue !== "string") {
    return null;
  }

  const platforms = normalizePlatforms(record.platform ?? record.platforms ?? record.channel ?? record.channels);
  return {
    id: fallbackId,
    title: titleValue.trim(),
    platform: platforms[0] ?? "X",
    day,
    time,
    status: normalizeStatus(record.status ?? record.stage) ?? "Scheduled",
  };
}

function parseSocialAccount(input: unknown, fallbackId: string): SocialAccount | null {
  if (typeof input === "string") {
    const platforms = normalizePlatforms(input);
    if (platforms.length === 0) {
      return null;
    }
    const platform = platforms[0];
    return {
      id: fallbackId,
      name: platform,
      handle: platform === "X" ? "@brand" : "brand/company",
      status: normalizeAccountStatus(input),
    };
  }

  const record = asRecord(input);
  if (!record) {
    return null;
  }

  const platformTokens = normalizePlatforms(record.platform ?? record.name ?? record.network);
  const platform = platformTokens[0];
  if (!platform) {
    return null;
  }

  const handleValue = [record.handle, record.username, record.account].find((value) => typeof value === "string");
  return {
    id: fallbackId,
    name: platform,
    handle: typeof handleValue === "string" && handleValue.trim() ? handleValue.trim() : platform === "X" ? "@brand" : "brand/company",
    status: normalizeAccountStatus(record.status ?? record.state),
  };
}

function minutesFromTime(time: string): number {
  const parts = time.split(":");
  if (parts.length !== 2) {
    return 0;
  }
  const hour = Number.parseInt(parts[0], 10);
  const minute = Number.parseInt(parts[1], 10);
  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    return 0;
  }
  return hour * 60 + minute;
}

function parseSocialData(assistantMessages: string[]): SocialData {
  const pipelineByTitle = new Map<string, ContentItem>();
  const scheduleByKey = new Map<string, CalendarPost>();
  const accountsByName = new Map<string, SocialAccount>();

  const addPipeline = (item: ContentItem | null) => {
    if (!item) return;
    pipelineByTitle.set(item.title.toLowerCase(), item);
  };

  const addSchedule = (item: CalendarPost | null) => {
    if (!item) return;
    scheduleByKey.set(`${item.day}|${item.time}|${item.platform}|${item.title.toLowerCase()}`, item);
  };

  const addAccount = (item: SocialAccount | null) => {
    if (!item) return;
    accountsByName.set(item.name.toLowerCase(), item);
  };

  for (const message of assistantMessages) {
    const structuredObjects = getJsonObjectsFromText(message);
    for (const objectValue of structuredObjects) {
      const rootRecord = asRecord(objectValue);
      if (!rootRecord) {
        continue;
      }

      const candidates: Record<string, unknown>[] = [rootRecord];
      const nestedSocial = asRecord(rootRecord.socialData ?? rootRecord.social ?? rootRecord.payload);
      if (nestedSocial) {
        candidates.push(nestedSocial);
      }

      for (const candidate of candidates) {
        const pipelineList =
          (Array.isArray(candidate.contentPipeline) && candidate.contentPipeline) ||
          (Array.isArray(candidate.pipeline) && candidate.pipeline) ||
          (Array.isArray(candidate.contentItems) && candidate.contentItems) ||
          [];
        pipelineList.forEach((entry, index) => addPipeline(parseContentItem(entry, `pipeline-${index}`)));

        const scheduleList =
          (Array.isArray(candidate.postingCalendar) && candidate.postingCalendar) ||
          (Array.isArray(candidate.schedule) && candidate.schedule) ||
          (Array.isArray(candidate.calendar) && candidate.calendar) ||
          (Array.isArray(candidate.scheduledPosts) && candidate.scheduledPosts) ||
          [];
        scheduleList.forEach((entry, index) => addSchedule(parseCalendarPost(entry, `scheduled-${index}`)));

        const accountList =
          (Array.isArray(candidate.socialAccounts) && candidate.socialAccounts) ||
          (Array.isArray(candidate.accounts) && candidate.accounts) ||
          (Array.isArray(candidate.connectedAccounts) && candidate.connectedAccounts) ||
          [];
        accountList.forEach((entry, index) => addAccount(parseSocialAccount(entry, `account-${index}`)));
      }
    }

    const lines = message
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    lines.forEach((line, index) => {
      if (normalizeStatus(line)) {
        addPipeline(parseContentItem(line, `heuristic-pipeline-${index}`));
      }
      if (/\b(mon|tue|wed|thu|fri)\b/i.test(line) && /\b\d{1,2}(:\d{2})?\s*(am|pm)?\b/i.test(line)) {
        addSchedule(parseCalendarPost(line, `heuristic-schedule-${index}`));
      }
      if (/\b(linkedin|twitter|x)\b/i.test(line) && /\b(connected|sync|error|failed|pending)\b/i.test(line)) {
        addAccount(parseSocialAccount(line, `heuristic-account-${index}`));
      }
    });
  }

  const pipeline = Array.from(pipelineByTitle.values()).sort((a, b) => {
    const statusCompare = PIPELINE_FLOW.indexOf(a.status) - PIPELINE_FLOW.indexOf(b.status);
    if (statusCompare !== 0) {
      return statusCompare;
    }
    return a.title.localeCompare(b.title);
  });

  const schedule = Array.from(scheduleByKey.values()).sort((a, b) => {
    const dayCompare = WEEK_DAYS.indexOf(a.day) - WEEK_DAYS.indexOf(b.day);
    if (dayCompare !== 0) {
      return dayCompare;
    }
    return minutesFromTime(a.time) - minutesFromTime(b.time);
  });

  const accounts = Array.from(accountsByName.values());

  return {
    pipeline:
      pipeline.length > 0
        ? pipeline
        : [
            { id: "pipeline-1", title: "Founder thread on product velocity", platforms: ["X", "LinkedIn"], status: "Draft" },
            { id: "pipeline-2", title: "Weekly build log recap", platforms: ["X"], status: "QA" },
            { id: "pipeline-3", title: "Customer win spotlight", platforms: ["LinkedIn"], status: "Approved" },
            { id: "pipeline-4", title: "Launch day announcement", platforms: ["X", "LinkedIn"], status: "Scheduled" },
          ],
    schedule:
      schedule.length > 0
        ? schedule
        : [
            { id: "post-1", title: "Ship update thread", platform: "X", day: "Mon", time: "09:00", status: "Scheduled" },
            { id: "post-2", title: "Thought leadership post", platform: "LinkedIn", day: "Wed", time: "13:00", status: "Scheduled" },
            { id: "post-3", title: "Community feedback roundup", platform: "X", day: "Fri", time: "16:00", status: "Scheduled" },
          ],
    accounts:
      accounts.length > 0
        ? accounts
        : [
            { id: "account-x", name: "X", handle: "@brand", status: "Connected" },
            { id: "account-linkedin", name: "LinkedIn", handle: "brand/company", status: "Connected" },
          ],
  };
}

function platformClass(platform: Platform): string {
  if (platform === "LinkedIn") {
    return "border-indigo-500/50 bg-indigo-500/20 text-indigo-100";
  }
  return "border-blue-500/60 bg-blue-500/20 text-blue-100";
}

function statusClass(status: PipelineStatus): string {
  if (status === "Draft") return "bg-slate-500/20 text-slate-200";
  if (status === "QA") return "bg-amber-500/20 text-amber-200";
  if (status === "Approved") return "bg-emerald-500/20 text-emerald-200";
  if (status === "Published") return "bg-cyan-500/20 text-cyan-200";
  return "bg-violet-500/20 text-violet-200";
}

export default function SocialPanel({ assistantMessages, onQuickAction }: SocialPanelProps) {
  const parsedData = useMemo(() => parseSocialData(assistantMessages), [assistantMessages]);
  const [posts, setPosts] = useState<CalendarPost[]>(parsedData.schedule);
  const [activePostId, setActivePostId] = useState<string | null>(null);

  useEffect(() => {
    setPosts(parsedData.schedule);
    setActivePostId((current) => (current && parsedData.schedule.some((post) => post.id === current) ? current : null));
  }, [parsedData.schedule]);

  const timeSlots = useMemo(() => {
    const defaults = ["09:00", "11:00", "13:00", "15:00", "17:00"];
    return Array.from(new Set([...defaults, ...posts.map((post) => post.time)])).sort((a, b) => minutesFromTime(a) - minutesFromTime(b));
  }, [posts]);

  const postsByCell = useMemo(() => {
    const map = new Map<string, CalendarPost[]>();
    posts.forEach((post) => {
      const key = `${post.day}-${post.time}`;
      const current = map.get(key) ?? [];
      current.push(post);
      map.set(key, current);
    });
    return map;
  }, [posts]);

  const activePost = useMemo(() => posts.find((post) => post.id === activePostId) ?? null, [posts, activePostId]);

  function updatePost<K extends keyof CalendarPost>(id: string, key: K, value: CalendarPost[K]) {
    setPosts((previous) => previous.map((post) => (post.id === id ? { ...post, [key]: value } : post)));
  }

  return (
    <aside className="flex h-full min-h-0 flex-col border-t border-[#1f2740] bg-[#0b1020] xl:border-l xl:border-t-0">
      <div className="border-b border-[#1f2740] px-4 py-3">
        <h3 className="text-sm font-semibold text-blue-100">ContentAI Panel</h3>
        <p className="text-xs text-blue-200/70">Pipeline, weekly calendar, and account status</p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <section className="rounded-xl border border-[#273152] bg-[#101731] p-3">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-blue-200">Content Pipeline</h4>
          <div className="space-y-2">
            {parsedData.pipeline.map((item) => (
              <div key={item.id} className="rounded-lg border border-[#2d375a] bg-[#0f152c] p-2.5">
                <p className="text-sm text-gray-100">{item.title}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {item.platforms.map((platform) => (
                    <span key={`${item.id}-${platform}`} className={`rounded-full border px-2 py-0.5 text-[11px] ${platformClass(platform)}`}>
                      {platform}
                    </span>
                  ))}
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusClass(item.status)}`}>{item.status}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-[#273152] bg-[#101731] p-3">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-blue-200">Posting Calendar</h4>
          <div className="overflow-x-auto">
            <div className="grid min-w-[700px] grid-cols-[72px_repeat(5,minmax(0,1fr))] rounded-lg border border-[#2d375a] bg-[#0d142a]">
              <div className="border-b border-r border-[#2d375a] p-2 text-[11px] uppercase text-gray-500">Time</div>
              {WEEK_DAYS.map((day) => (
                <div key={day} className="border-b border-[#2d375a] p-2 text-center text-xs font-semibold text-blue-100">
                  {day}
                </div>
              ))}

              {timeSlots.map((time) => (
                <Fragment key={time}>
                  <div className="border-r border-t border-[#2d375a] p-2 text-[11px] text-gray-400">{time}</div>
                  {WEEK_DAYS.map((day) => {
                    const cellPosts = postsByCell.get(`${day}-${time}`) ?? [];
                    return (
                      <div key={`${day}-${time}`} className="min-h-[64px] border-t border-[#2d375a] bg-[#0b1123] p-1.5">
                        <div className="flex flex-col gap-1">
                          {cellPosts.map((post) => (
                            <button
                              key={post.id}
                              type="button"
                              onClick={() => setActivePostId(post.id)}
                              className={`rounded-md border px-2 py-1 text-left text-[11px] transition-colors hover:brightness-110 ${platformClass(
                                post.platform
                              )}`}
                            >
                              <p className="truncate font-medium">{post.title}</p>
                              <p className="text-[10px] opacity-80">{post.platform}</p>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </Fragment>
              ))}
            </div>
          </div>

          {activePost && (
            <div className="mt-3 rounded-lg border border-[#36477b] bg-[#111a37] p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-200">Edit Scheduled Post</p>
                <button
                  type="button"
                  onClick={() => setActivePostId(null)}
                  className="rounded border border-[#3f4d79] px-2 py-0.5 text-[11px] text-gray-300 hover:text-white"
                >
                  Close
                </button>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-xs text-gray-300">
                  Title
                  <input
                    value={activePost.title}
                    onChange={(event) => updatePost(activePost.id, "title", event.target.value)}
                    className="mt-1 w-full rounded border border-[#3a456f] bg-[#0a1020] px-2 py-1.5 text-xs text-gray-100 focus:border-blue-500 focus:outline-none"
                  />
                </label>
                <label className="text-xs text-gray-300">
                  Platform
                  <select
                    value={activePost.platform}
                    onChange={(event) => updatePost(activePost.id, "platform", event.target.value as Platform)}
                    className="mt-1 w-full rounded border border-[#3a456f] bg-[#0a1020] px-2 py-1.5 text-xs text-gray-100 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="X">X</option>
                    <option value="LinkedIn">LinkedIn</option>
                  </select>
                </label>
                <label className="text-xs text-gray-300">
                  Day
                  <select
                    value={activePost.day}
                    onChange={(event) => updatePost(activePost.id, "day", event.target.value as WeekDay)}
                    className="mt-1 w-full rounded border border-[#3a456f] bg-[#0a1020] px-2 py-1.5 text-xs text-gray-100 focus:border-blue-500 focus:outline-none"
                  >
                    {WEEK_DAYS.map((day) => (
                      <option key={day} value={day}>
                        {day}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-gray-300">
                  Time
                  <input
                    value={activePost.time}
                    onChange={(event) => {
                      const normalized = normalizeTime(event.target.value);
                      if (normalized) {
                        updatePost(activePost.id, "time", normalized);
                      }
                    }}
                    className="mt-1 w-full rounded border border-[#3a456f] bg-[#0a1020] px-2 py-1.5 text-xs text-gray-100 focus:border-blue-500 focus:outline-none"
                  />
                </label>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-[#273152] bg-[#101731] p-3">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-blue-200">Social Accounts</h4>
          <div className="space-y-2">
            {parsedData.accounts.map((account) => (
              <div key={account.id} className="flex items-center justify-between rounded-lg border border-[#2d375a] bg-[#0f152c] px-2.5 py-2">
                <div>
                  <p className="text-sm text-gray-100">{account.name}</p>
                  <p className="text-xs text-gray-400">{account.handle}</p>
                </div>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${
                    account.status === "Connected"
                      ? "bg-emerald-500/20 text-emerald-200"
                      : account.status === "Syncing"
                        ? "bg-amber-500/20 text-amber-200"
                        : "bg-rose-500/20 text-rose-200"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      account.status === "Connected"
                        ? "bg-emerald-300"
                        : account.status === "Syncing"
                          ? "bg-amber-300"
                          : "bg-rose-300"
                    }`}
                  />
                  {account.status}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-[#273152] bg-[#101731] p-3">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-blue-200">Quick Actions</h4>
          <div className="grid gap-2 sm:grid-cols-3">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action}
                type="button"
                onClick={() => onQuickAction?.(action)}
                className="rounded-lg border border-[#33509b] bg-[#1f3366] px-3 py-2 text-xs font-semibold text-blue-100 transition-colors hover:bg-[#294382]"
              >
                {action}
              </button>
            ))}
          </div>
        </section>
      </div>
    </aside>
  );
}
