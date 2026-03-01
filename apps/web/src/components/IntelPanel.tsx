"use client";

import { useMemo } from "react";

type Role = "user" | "assistant" | "system";

type ChatMessage = {
  id?: string;
  role: Role;
  content: string;
  createdAt?: string;
};

type TargetType = "company" | "person" | "topic" | "unknown";
type IntelCategory = "product" | "hiring" | "funding" | "tech";
type Severity = "high" | "medium" | "low";

type IntelFinding = {
  id: string;
  timestampLabel: string;
  timestampSort: number;
  dayKey: string;
  dayLabel: string;
  category: IntelCategory;
  title: string;
  snippet: string;
  sourceUrl?: string;
  severity: Severity;
};

type KeySignal = {
  id: string;
  text: string;
  severity: Severity;
};

type IntelPanelProps = {
  messages: ChatMessage[];
  className?: string;
};

const CATEGORY_STYLES: Record<IntelCategory, { badge: string; border: string; label: string }> = {
  product: {
    badge: "bg-[#1b2b49] text-[#9dc3ff] border-[#2a4672]",
    border: "border-l-[#3b82f6]",
    label: "product",
  },
  hiring: {
    badge: "bg-[#1c3322] text-[#a8efb7] border-[#2d5d38]",
    border: "border-l-[#22c55e]",
    label: "hiring",
  },
  funding: {
    badge: "bg-[#39240f] text-[#fdc98d] border-[#6a3a16]",
    border: "border-l-[#f59e0b]",
    label: "funding",
  },
  tech: {
    badge: "bg-[#2a1f43] text-[#d1b7ff] border-[#4b3a70]",
    border: "border-l-[#8b5cf6]",
    label: "tech",
  },
};

const SEVERITY_META: Record<Severity, { icon: string; className: string }> = {
  high: { icon: "🔴", className: "text-[#fca5a5]" },
  medium: { icon: "🟡", className: "text-[#fde68a]" },
  low: { icon: "🟢", className: "text-[#86efac]" },
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function firstString(data: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const found = asString(data[key]);
    if (found) {
      return found;
    }
  }
  return null;
}

function firstArray(data: Record<string, unknown>, keys: string[]): unknown[] {
  for (const key of keys) {
    const value = data[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [];
}

function stripMarkdown(value: string): string {
  return value
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/[`*_>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function safeJsonParse(input: string): unknown {
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return null;
  }
}

function parseJsonBlocks(content: string): unknown[] {
  const parsed: unknown[] = [];
  const blockPattern = /```(?:json)?\s*([\s\S]*?)```/gi;

  let match = blockPattern.exec(content);
  while (match) {
    const payload = match[1]?.trim();
    if (payload) {
      const data = safeJsonParse(payload);
      if (data) {
        parsed.push(data);
      }
    }
    match = blockPattern.exec(content);
  }

  const trimmed = content.trim();
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    const inlineData = safeJsonParse(trimmed);
    if (inlineData) {
      parsed.push(inlineData);
    }
  }

  return parsed;
}

function extractUrl(text: string): string | undefined {
  const match = text.match(/https?:\/\/[^\s)]+/i);
  return match?.[0];
}

function findDateToken(text: string): string | null {
  const iso = text.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (iso?.[0]) {
    return iso[0];
  }

  const month = text.match(
    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b/i
  );
  if (month?.[0]) {
    return month[0];
  }

  return null;
}

function normalizeCategory(categoryRaw: string | null, textContext: string): IntelCategory {
  const value = `${categoryRaw ?? ""} ${textContext}`.toLowerCase();

  if (value.includes("fund") || value.includes("raise") || value.includes("invest") || value.includes("series ")) {
    return "funding";
  }
  if (value.includes("hir") || value.includes("job") || value.includes("talent") || value.includes("recruit")) {
    return "hiring";
  }
  if (value.includes("tech") || value.includes("stack") || value.includes("infra") || value.includes("engineering")) {
    return "tech";
  }
  return "product";
}

function normalizeSeverity(raw: string | null, textContext: string): Severity {
  const value = `${raw ?? ""} ${textContext}`.toLowerCase();
  if (value.includes("high") || value.includes("critical") || value.includes("urgent") || value.includes("risk")) {
    return "high";
  }
  if (value.includes("medium") || value.includes("moderate") || value.includes("watch")) {
    return "medium";
  }
  return "low";
}

function normalizeTargetType(raw: string | null, targetName: string): TargetType {
  const value = (raw ?? "").toLowerCase();
  if (value.includes("company")) {
    return "company";
  }
  if (value.includes("person") || value.includes("executive") || value.includes("founder")) {
    return "person";
  }
  if (value.includes("topic") || value.includes("market") || value.includes("trend")) {
    return "topic";
  }

  const loweredTarget = targetName.toLowerCase();
  if (/(inc|corp|corporation|llc|ltd|company)\b/.test(loweredTarget)) {
    return "company";
  }
  if (/\b(ai|market|industry|topic|trend)\b/.test(loweredTarget)) {
    return "topic";
  }
  if (targetName.split(/\s+/).filter(Boolean).length >= 2) {
    return "person";
  }
  return "unknown";
}

function parseTimestamp(timestampRaw: string | null): {
  timestampLabel: string;
  timestampSort: number;
  dayKey: string;
  dayLabel: string;
} {
  const fallback = {
    timestampLabel: "Undated",
    timestampSort: Number.NEGATIVE_INFINITY,
    dayKey: "undated",
    dayLabel: "Undated",
  };

  if (!timestampRaw) {
    return fallback;
  }

  const parsed = new Date(timestampRaw);
  if (Number.isNaN(parsed.getTime())) {
    return {
      timestampLabel: timestampRaw,
      timestampSort: Number.NEGATIVE_INFINITY,
      dayKey: "undated",
      dayLabel: "Undated",
    };
  }

  const dayKey = parsed.toISOString().slice(0, 10);

  return {
    timestampLabel: parsed.toLocaleString([], {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }),
    timestampSort: parsed.getTime(),
    dayKey,
    dayLabel: parsed.toLocaleDateString([], {
      year: "numeric",
      month: "short",
      day: "2-digit",
    }),
  };
}

function normalizeFinding(
  id: string,
  raw: Record<string, unknown>,
  fallbackTimestamp: string | null
): IntelFinding | null {
  const title = firstString(raw, ["title", "headline", "name", "signal"]);
  const snippet = firstString(raw, ["snippet", "summary", "description", "details", "text"]);
  const sourceUrl = firstString(raw, ["sourceUrl", "source_url", "source", "url", "link"]) ?? undefined;
  const timestamp = firstString(raw, ["timestamp", "time", "date", "publishedAt", "published_at"]) ?? fallbackTimestamp;
  const context = `${title ?? ""} ${snippet ?? ""}`;
  const category = normalizeCategory(firstString(raw, ["category", "type", "tag"]), context);
  const severity = normalizeSeverity(firstString(raw, ["severity", "priority", "risk"]), context);

  const displayTitle = title ?? (snippet ? stripMarkdown(snippet).slice(0, 100) : null);
  const displaySnippet = snippet ?? title ?? "";
  if (!displayTitle || !displaySnippet) {
    return null;
  }

  const time = parseTimestamp(timestamp);

  return {
    id,
    ...time,
    category,
    title: stripMarkdown(displayTitle),
    snippet: stripMarkdown(displaySnippet),
    sourceUrl: sourceUrl ?? extractUrl(displaySnippet),
    severity,
  };
}

function normalizeSignal(id: string, raw: unknown): KeySignal | null {
  if (typeof raw === "string") {
    const clean = stripMarkdown(raw);
    if (!clean) {
      return null;
    }
    return {
      id,
      text: clean,
      severity: normalizeSeverity(null, clean),
    };
  }

  const object = asObject(raw);
  if (!object) {
    return null;
  }

  const text = firstString(object, ["text", "title", "signal", "summary", "description"]);
  if (!text) {
    return null;
  }

  return {
    id,
    text: stripMarkdown(text),
    severity: normalizeSeverity(firstString(object, ["severity", "priority", "risk"]), text),
  };
}

function extractObjects(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.map(asObject).filter((item): item is Record<string, unknown> => Boolean(item));
  }
  const single = asObject(payload);
  return single ? [single] : [];
}

function parseTargetFromText(content: string): { name: string; type: TargetType } | null {
  const briefMatch = content.match(/intelligence\s+brief:\s*\[?([^\]\n]+)\]?/i);
  if (briefMatch?.[1]) {
    const name = stripMarkdown(briefMatch[1]);
    return { name, type: normalizeTargetType(null, name) };
  }

  const targetMatch = content.match(/target:\s*(.+)/i);
  if (targetMatch?.[1]) {
    const name = stripMarkdown(targetMatch[1].split("\n")[0] ?? "");
    if (name) {
      return { name, type: normalizeTargetType(null, name) };
    }
  }

  return null;
}

function parseFindingsFromText(content: string, prefix: string, fallbackTimestamp: string | null): IntelFinding[] {
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const findings: IntelFinding[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!/^[-*]\s+|^\d+[.):-]\s+/.test(line)) {
      continue;
    }

    const body = stripMarkdown(line.replace(/^[-*]\s+|^\d+[.):-]\s+/, ""));
    if (body.length < 24) {
      continue;
    }

    const hasSignalLikeContent = /(product|launch|release|hire|hiring|fund|raise|stack|tech|infrastructure|partnership|acquisition)/i.test(body);
    const dateToken = findDateToken(body);
    if (!hasSignalLikeContent && !dateToken) {
      continue;
    }

    const sourceUrl = extractUrl(body);
    const splitMatch = body.split(/\s[—-]\s|:\s/);
    const title = splitMatch[0]?.trim() || body.slice(0, 90);
    const timestamp = dateToken ?? fallbackTimestamp;
    const time = parseTimestamp(timestamp);
    const category = normalizeCategory(null, body);
    const severity = normalizeSeverity(null, body);

    findings.push({
      id: `${prefix}-text-${i}`,
      ...time,
      category,
      title,
      snippet: body,
      sourceUrl,
      severity,
    });
  }

  return findings;
}

function parseSignalsFromText(content: string, prefix: string): KeySignal[] {
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const signals: KeySignal[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!/^[-*]\s+|^\d+[.):-]\s+/.test(line)) {
      continue;
    }

    const body = stripMarkdown(line.replace(/^[-*]\s+|^\d+[.):-]\s+/, ""));
    if (/(recommended action|analysis|confidence)/i.test(body) || body.length < 18) {
      continue;
    }

    const severity = normalizeSeverity(null, body);
    if (severity === "low" && !/(high|medium|low|risk|watch|alert|critical)/i.test(body)) {
      continue;
    }

    signals.push({
      id: `${prefix}-signal-${i}`,
      text: body,
      severity,
    });
  }

  return signals;
}

function dedupeFindings(findings: IntelFinding[]): IntelFinding[] {
  const map = new Map<string, IntelFinding>();
  for (const finding of findings) {
    const key = `${finding.title.toLowerCase()}|${finding.timestampLabel}|${finding.sourceUrl ?? ""}`;
    if (!map.has(key)) {
      map.set(key, finding);
    }
  }
  return Array.from(map.values());
}

function dedupeSignals(signals: KeySignal[]): KeySignal[] {
  const map = new Map<string, KeySignal>();
  for (const signal of signals) {
    const key = signal.text.toLowerCase();
    if (!map.has(key)) {
      map.set(key, signal);
    }
  }
  return Array.from(map.values());
}

function parseIntel(messages: ChatMessage[]) {
  let targetName = "";
  let targetType: TargetType = "unknown";
  const findings: IntelFinding[] = [];
  const signals: KeySignal[] = [];

  const assistantMessages = messages.filter((message) => message.role === "assistant");

  for (let messageIndex = 0; messageIndex < assistantMessages.length; messageIndex += 1) {
    const message = assistantMessages[messageIndex];
    const prefix = message.id ?? `assistant-${messageIndex}`;
    const fallbackTimestamp = message.createdAt ?? null;
    const jsonPayloads = parseJsonBlocks(message.content);
    const rootObjects = jsonPayloads.flatMap((payload) => extractObjects(payload));

    for (let objectIndex = 0; objectIndex < rootObjects.length; objectIndex += 1) {
      const root = rootObjects[objectIndex];
      const wrappedObjectCandidates = [
        root,
        asObject(root.intel),
        asObject(root.data),
        asObject(root.result),
        asObject(root.payload),
        asObject(root.brief),
      ].filter((value): value is Record<string, unknown> => Boolean(value));

      for (let wrapperIndex = 0; wrapperIndex < wrappedObjectCandidates.length; wrapperIndex += 1) {
        const obj = wrappedObjectCandidates[wrapperIndex];

        const targetRaw = obj.target;
        if (typeof targetRaw === "string" && targetRaw.trim()) {
          targetName = targetRaw.trim();
          targetType = normalizeTargetType(firstString(obj, ["targetType", "target_type", "type"]), targetName);
        } else {
          const targetObj = asObject(targetRaw);
          if (targetObj) {
            const nextName = firstString(targetObj, ["name", "target", "title"]);
            if (nextName) {
              targetName = nextName;
              targetType = normalizeTargetType(
                firstString(targetObj, ["type", "targetType", "target_type"]) ??
                  firstString(obj, ["targetType", "target_type"]),
                targetName
              );
            }
          }
        }

        if (!targetName) {
          const flatTarget = firstString(obj, ["targetName", "target_name"]);
          if (flatTarget) {
            targetName = flatTarget;
            targetType = normalizeTargetType(firstString(obj, ["targetType", "target_type"]), targetName);
          }
        }

        const candidateLists = [
          firstArray(obj, ["findings", "signals", "intelFeed", "intel_feed", "entries", "items", "timeline"]),
          firstArray(root, ["findings", "signals", "intelFeed", "intel_feed", "entries", "items", "timeline"]),
        ];

        for (let listIndex = 0; listIndex < candidateLists.length; listIndex += 1) {
          const list = candidateLists[listIndex];
          for (let findingIndex = 0; findingIndex < list.length; findingIndex += 1) {
            const record = asObject(list[findingIndex]);
            if (!record) {
              continue;
            }

            const normalized = normalizeFinding(
              `${prefix}-obj-${objectIndex}-${wrapperIndex}-${listIndex}-${findingIndex}`,
              record,
              fallbackTimestamp
            );
            if (normalized) {
              findings.push(normalized);
            }
          }
        }

        const keySignalLists = [
          firstArray(obj, ["keySignals", "key_signals", "highlights", "alerts"]),
          firstArray(root, ["keySignals", "key_signals", "highlights", "alerts"]),
        ];

        for (let listIndex = 0; listIndex < keySignalLists.length; listIndex += 1) {
          const list = keySignalLists[listIndex];
          for (let signalIndex = 0; signalIndex < list.length; signalIndex += 1) {
            const normalized = normalizeSignal(`${prefix}-key-${objectIndex}-${listIndex}-${signalIndex}`, list[signalIndex]);
            if (normalized) {
              signals.push(normalized);
            }
          }
        }
      }
    }

    const textTarget = parseTargetFromText(message.content);
    if (textTarget) {
      targetName = textTarget.name;
      targetType = textTarget.type;
    }

    findings.push(...parseFindingsFromText(message.content, prefix, fallbackTimestamp));
    signals.push(...parseSignalsFromText(message.content, prefix));
  }

  const dedupedFindings = dedupeFindings(findings)
    .sort((a, b) => b.timestampSort - a.timestampSort)
    .map((finding, index) => ({ ...finding, id: `${finding.id}-${index}` }));

  const derivedSignals = dedupedFindings
    .filter((finding) => finding.severity !== "low")
    .slice(0, 6)
    .map((finding, index) => ({
      id: `derived-${index}`,
      text: `${finding.title} (${CATEGORY_STYLES[finding.category].label})`,
      severity: finding.severity,
    }));

  const dedupedSignals = dedupeSignals([...signals, ...derivedSignals]).slice(0, 6);

  return {
    targetName: targetName || "Awaiting target",
    targetType,
    findings: dedupedFindings,
    signals: dedupedSignals,
  };
}

export default function IntelPanel({ messages, className = "" }: IntelPanelProps) {
  const intel = useMemo(() => parseIntel(messages), [messages]);

  const timeline = useMemo(() => {
    const groups = new Map<string, { label: string; items: IntelFinding[] }>();

    for (const finding of intel.findings) {
      const current = groups.get(finding.dayKey);
      if (current) {
        current.items.push(finding);
      } else {
        groups.set(finding.dayKey, { label: finding.dayLabel, items: [finding] });
      }
    }

    return Array.from(groups.entries())
      .sort((a, b) => {
        if (a[0] === "undated") {
          return 1;
        }
        if (b[0] === "undated") {
          return -1;
        }
        return a[0] > b[0] ? -1 : 1;
      })
      .map(([key, value]) => ({
        key,
        label: value.label,
        items: value.items,
      }));
  }, [intel.findings]);

  return (
    <aside className={`min-h-0 border-t border-[#1f1f28] bg-[#0d0f14] lg:border-l lg:border-t-0 ${className}`}>
      <div className="border-b border-[#1f2430] px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-100">Intel Dashboard</h3>
      </div>

      <div className="h-full space-y-5 overflow-y-auto px-4 py-4">
        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-400">Monitoring Target</h4>
          <div className="rounded-xl border border-[#253040] bg-[#11151d] p-3">
            <p className="text-sm font-medium text-gray-100">{intel.targetName}</p>
            <p className="mt-1 text-xs text-gray-400">
              Type: <span className="capitalize text-gray-200">{intel.targetType}</span>
            </p>
          </div>
        </section>

        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-400">Intel Feed</h4>
          <div className="space-y-2">
            {intel.findings.length === 0 ? (
              <p className="rounded-lg border border-[#232936] bg-[#11151d] px-3 py-2 text-xs text-gray-500">
                No intel findings parsed yet. Structured findings will appear here as responses stream in.
              </p>
            ) : (
              intel.findings.map((finding) => {
                const categoryStyle = CATEGORY_STYLES[finding.category];
                return (
                  <article
                    key={finding.id}
                    className={`rounded-lg border border-[#212838] border-l-4 bg-[#101520] p-3 ${categoryStyle.border}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] text-gray-500">{finding.timestampLabel}</p>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${categoryStyle.badge}`}>
                        {categoryStyle.label}
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-medium text-gray-100">{finding.title}</p>
                    <p className="mt-1 text-xs text-gray-300">{finding.snippet}</p>
                    {finding.sourceUrl && (
                      <a
                        href={finding.sourceUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="mt-2 inline-block text-xs text-[#7ec8ff] hover:text-[#9bd7ff]"
                      >
                        Source
                      </a>
                    )}
                  </article>
                );
              })
            )}
          </div>
        </section>

        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-400">Key Signals</h4>
          <div className="space-y-2">
            {intel.signals.length === 0 ? (
              <p className="rounded-lg border border-[#232936] bg-[#11151d] px-3 py-2 text-xs text-gray-500">
                No high-confidence signals detected yet.
              </p>
            ) : (
              intel.signals.map((signal) => {
                const meta = SEVERITY_META[signal.severity];
                return (
                  <div key={signal.id} className="rounded-lg border border-[#232936] bg-[#11151d] px-3 py-2">
                    <p className={`text-xs font-medium ${meta.className}`}>
                      {meta.icon} {signal.severity}
                    </p>
                    <p className="mt-1 text-xs text-gray-200">{signal.text}</p>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="space-y-2 pb-2">
          <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-400">Timeline</h4>
          <div className="space-y-3">
            {timeline.length === 0 ? (
              <p className="rounded-lg border border-[#232936] bg-[#11151d] px-3 py-2 text-xs text-gray-500">
                Timeline is empty until dated findings are available.
              </p>
            ) : (
              timeline.map((group) => (
                <div key={group.key} className="rounded-lg border border-[#232936] bg-[#11151d] p-3">
                  <p className="text-xs font-semibold text-gray-200">{group.label}</p>
                  <div className="mt-2 space-y-1">
                    {group.items.slice(0, 4).map((item) => (
                      <p key={item.id} className="text-xs text-gray-400">
                        • {item.title}
                      </p>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </aside>
  );
}
