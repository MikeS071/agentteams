"use client";

import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

type Role = "user" | "assistant" | "system";
type PipelineStatus = "pending" | "running" | "done";
type SourceStatus = "found" | "extracted" | "analyzed";
type EvidenceTag = "supporting" | "contrasting" | "mentioning";
type StageKey = "plan" | "search" | "read" | "analyze" | "gap_analysis" | "synthesize" | "report";

export type ResearchPanelMessage = {
  role: Role;
  content: string;
};

type StepMeta = {
  status?: PipelineStatus;
  detail?: string;
};

type SourceItem = {
  id: string;
  title: string;
  url: string;
  relevance?: number;
  status: SourceStatus;
  evidence: EvidenceTag;
  excerpt?: string;
};

type Snapshot = {
  currentStage?: StageKey;
  complete: boolean;
  steps: Partial<Record<StageKey, StepMeta>>;
  sources: SourceItem[];
  gaps: string[];
  gapRound: number;
  reportMarkdown: string;
};

type Patch = {
  currentStage?: StageKey;
  complete?: boolean;
  steps?: Partial<Record<StageKey, StepMeta>>;
  sources?: SourceItem[];
  gaps?: string[];
  gapRound?: number;
  reportMarkdown?: string;
};

type Props = {
  messages: ResearchPanelMessage[];
  liveEvents?: Record<string, unknown>[];
  onSendDirection?: (direction: string) => void;
  disabled?: boolean;
};

const STAGES: Array<{ key: StageKey; label: string; icon: string; detail: string }> = [
  { key: "plan", label: "Plan", icon: "🧭", detail: "Generating sub-queries" },
  { key: "search", label: "Search", icon: "🔎", detail: "Querying sources" },
  { key: "read", label: "Read", icon: "📖", detail: "Extracting content" },
  { key: "analyze", label: "Analyze", icon: "🧠", detail: "Per-source analysis" },
  { key: "gap_analysis", label: "Gap Analysis", icon: "🧩", detail: "Identifying low-coverage areas" },
  { key: "synthesize", label: "Synthesize", icon: "🧵", detail: "Cross-referencing evidence" },
  { key: "report", label: "Report", icon: "📝", detail: "Generating final output" },
];

const EMPTY_SNAPSHOT: Snapshot = {
  complete: false,
  steps: {},
  sources: [],
  gaps: [],
  gapRound: 1,
  reportMarkdown: "",
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function normalizeStageKey(value: unknown): StageKey | undefined {
  const raw = asString(value).toLowerCase().replace(/[^a-z]/g, "");
  if (!raw) {
    return undefined;
  }

  if (raw === "plan") return "plan";
  if (raw === "search") return "search";
  if (raw === "read" || raw === "extract" || raw === "extracting") return "read";
  if (raw === "analyze" || raw === "analysis") return "analyze";
  if (raw === "gapanalysis" || raw === "gap") return "gap_analysis";
  if (raw === "synthesize" || raw === "synthesis") return "synthesize";
  if (raw === "report" || raw === "final") return "report";

  return undefined;
}

function normalizePipelineStatus(value: unknown): PipelineStatus | undefined {
  const raw = asString(value).toLowerCase();
  if (!raw) {
    return undefined;
  }
  if (["pending", "queued", "todo", "idle", "wait"].includes(raw)) return "pending";
  if (["running", "in_progress", "in-progress", "active", "processing"].includes(raw)) return "running";
  if (["done", "completed", "complete", "success", "finished"].includes(raw)) return "done";
  return undefined;
}

function normalizeSourceStatus(value: unknown): SourceStatus {
  const raw = asString(value).toLowerCase();
  if (raw === "analyzed" || raw === "analysis_done") return "analyzed";
  if (raw === "extracted" || raw === "read") return "extracted";
  return "found";
}

function normalizeEvidence(value: unknown): EvidenceTag {
  const raw = asString(value).toLowerCase();
  if (["supporting", "support", "supports", "positive", "pro"].includes(raw)) return "supporting";
  if (["contrasting", "contrast", "opposing", "against", "con"].includes(raw)) return "contrasting";
  return "mentioning";
}

function clampRelevance(value: unknown): number | undefined {
  const parsed = asNumber(value);
  if (typeof parsed !== "number") {
    return undefined;
  }
  if (parsed < 0) return 0;
  if (parsed > 1) return 1;
  return parsed;
}

function objectValuesToSources(value: Record<string, unknown>): SourceItem[] {
  const nested = Object.values(value)
    .map((item) => asObject(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));
  return nested.map((item) => parseSource(item)).filter((item): item is SourceItem => Boolean(item));
}

function parseSource(raw: Record<string, unknown>): SourceItem | null {
  const title =
    asString(raw.title) ||
    asString(raw.name) ||
    asString(raw.source_title) ||
    asString(raw.documentTitle) ||
    asString(raw.domain);
  const url =
    asString(raw.url) ||
    asString(raw.link) ||
    asString(raw.source_url) ||
    asString(raw.sourceUrl) ||
    asString(raw.href);

  if (!title && !url) {
    return null;
  }

  const sourceId = asString(raw.id) || url || title.toLowerCase();
  const relevance = clampRelevance(raw.relevance ?? raw.score ?? raw.relevanceScore);

  let status = normalizeSourceStatus(raw.status);
  if (raw.analyzed === true) {
    status = "analyzed";
  } else if (raw.extracted === true) {
    status = "extracted";
  }

  return {
    id: sourceId,
    title: title || url,
    url,
    relevance,
    status,
    evidence: normalizeEvidence(raw.evidence ?? raw.tag ?? raw.stance),
    excerpt: asString(raw.excerpt) || asString(raw.snippet) || asString(raw.summary),
  };
}

function parseSteps(raw: unknown): Partial<Record<StageKey, StepMeta>> {
  const byStage: Partial<Record<StageKey, StepMeta>> = {};

  if (Array.isArray(raw)) {
    for (const item of raw) {
      const obj = asObject(item);
      if (!obj) continue;
      const key = normalizeStageKey(obj.stage ?? obj.name ?? obj.label ?? obj.id);
      if (!key) continue;
      byStage[key] = {
        status: normalizePipelineStatus(obj.status ?? obj.state),
        detail: asString(obj.detail) || asString(obj.description) || asString(obj.message),
      };
    }
    return byStage;
  }

  const obj = asObject(raw);
  if (!obj) {
    return byStage;
  }

  for (const [stepName, stepValue] of Object.entries(obj)) {
    const key = normalizeStageKey(stepName);
    if (!key) continue;

    if (typeof stepValue === "string") {
      byStage[key] = {
        status: normalizePipelineStatus(stepValue),
      };
      continue;
    }

    const stepObj = asObject(stepValue);
    if (!stepObj) {
      continue;
    }

    byStage[key] = {
      status: normalizePipelineStatus(stepObj.status ?? stepObj.state),
      detail: asString(stepObj.detail) || asString(stepObj.description) || asString(stepObj.message),
    };
  }

  return byStage;
}

function parseGapList(raw: unknown): string[] {
  if (!raw) {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw
      .map((item) => (typeof item === "string" ? item : asString(asObject(item)?.topic)))
      .map((item) => item.trim())
      .filter(Boolean);
  }
  const single = asString(raw);
  return single ? [single] : [];
}

function collectObjects(value: unknown, out: Record<string, unknown>[]) {
  const obj = asObject(value);
  if (obj) {
    out.push(obj);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectObjects(item, out);
    }
  }
}

function extractJsonObjects(content: string): Record<string, unknown>[] {
  if (!content.trim()) {
    return [];
  }

  const candidates: string[] = [];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null = null;
  while ((match = fenced.exec(content)) !== null) {
    const payload = match[1]?.trim();
    if (payload) {
      candidates.push(payload);
    }
  }

  const trimmed = content.trim();
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    candidates.push(trimmed);
  }

  const objects: Record<string, unknown>[] = [];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      collectObjects(parsed, objects);
    } catch {
      // Ignore invalid JSON blocks.
    }
  }
  return objects;
}

function parsePatch(raw: Record<string, unknown>): Patch {
  const patch: Patch = {};
  const candidates: Record<string, unknown>[] = [raw];

  const nestedPipeline = asObject(raw.pipeline) ?? asObject(raw.pipeline_state) ?? asObject(raw.pipelineState);
  if (nestedPipeline) {
    candidates.push(nestedPipeline);
  }
  const nestedResearch = asObject(raw.research) ?? asObject(raw.research_state) ?? asObject(raw.researchState);
  if (nestedResearch) {
    candidates.push(nestedResearch);
  }
  const nestedData = asObject(raw.data);
  if (nestedData) {
    candidates.push(nestedData);
  }

  for (const entry of candidates) {
    const stage = normalizeStageKey(entry.currentStage ?? entry.stage ?? entry.phase ?? entry.pipelineStage);
    if (stage) {
      patch.currentStage = stage;
    }

    const maybeDone =
      normalizePipelineStatus(entry.status ?? entry.state) === "done" ||
      normalizePipelineStatus(entry.pipelineStatus) === "done" ||
      entry.done === true ||
      entry.completed === true;
    if (maybeDone) {
      patch.complete = true;
    }

    const stepUpdate = parseSteps(entry.steps);
    if (Object.keys(stepUpdate).length > 0) {
      patch.steps = { ...(patch.steps || {}), ...stepUpdate };
    }

    const sources: SourceItem[] = [];
    if (Array.isArray(entry.sources)) {
      sources.push(
        ...entry.sources
          .map((source) => asObject(source))
          .filter((source): source is Record<string, unknown> => Boolean(source))
          .map((source) => parseSource(source))
          .filter((source): source is SourceItem => Boolean(source))
      );
    } else {
      const objectSources = asObject(entry.sources);
      if (objectSources) {
        sources.push(...objectValuesToSources(objectSources));
      }
    }

    for (const key of ["source", "document", "reference"]) {
      const single = asObject(entry[key]);
      if (single) {
        const parsed = parseSource(single);
        if (parsed) {
          sources.push(parsed);
        }
      }
    }

    const likelySource = parseSource(entry);
    if (likelySource && asString(entry.type).toLowerCase().includes("source")) {
      sources.push(likelySource);
    }

    if (sources.length > 0) {
      patch.sources = [...(patch.sources || []), ...sources];
    }

    const gapBlock = asObject(entry.gapAnalysis) ?? asObject(entry.gap_analysis);
    if (gapBlock) {
      const gaps = parseGapList(gapBlock.gaps ?? gapBlock.topics ?? gapBlock.items);
      if (gaps.length > 0) {
        patch.gaps = gaps;
      }
      const round = asNumber(gapBlock.round ?? gapBlock.roundNumber);
      if (typeof round === "number") {
        patch.gapRound = Math.max(1, Math.floor(round));
      }
    }

    const directGaps = parseGapList(entry.gaps ?? entry.coverage_gaps ?? entry.missing_topics ?? entry.missingTopics);
    if (directGaps.length > 0) {
      patch.gaps = directGaps;
    }

    const round = asNumber(entry.gapRound ?? entry.round);
    if (typeof round === "number") {
      patch.gapRound = Math.max(1, Math.floor(round));
    }

    const reportCandidate =
      asString(entry.reportMarkdown) ||
      asString(entry.finalReport) ||
      asString(entry.final_report) ||
      asString(entry.report);
    if (reportCandidate) {
      patch.reportMarkdown = reportCandidate;
    }

    const reportObj = asObject(entry.report);
    if (reportObj) {
      const nestedReport = asString(reportObj.markdown) || asString(reportObj.content) || asString(reportObj.text);
      if (nestedReport) {
        patch.reportMarkdown = nestedReport;
      }
    }
  }

  return patch;
}

function sourceKey(source: SourceItem): string {
  return source.url || source.id || source.title.toLowerCase();
}

function mergeSnapshots(base: Snapshot, patch: Patch): Snapshot {
  const mergedSteps: Partial<Record<StageKey, StepMeta>> = { ...base.steps };
  if (patch.steps) {
    for (const [stage, meta] of Object.entries(patch.steps) as Array<[StageKey, StepMeta]>) {
      const existing = mergedSteps[stage] || {};
      mergedSteps[stage] = {
        status: meta.status ?? existing.status,
        detail: meta.detail ?? existing.detail,
      };
    }
  }

  const sourceMap = new Map<string, SourceItem>();
  for (const item of base.sources) {
    sourceMap.set(sourceKey(item), item);
  }
  for (const item of patch.sources || []) {
    const key = sourceKey(item);
    const existing = sourceMap.get(key);
    if (!existing) {
      sourceMap.set(key, item);
      continue;
    }
    sourceMap.set(key, {
      ...existing,
      ...item,
      excerpt: item.excerpt || existing.excerpt,
      relevance: typeof item.relevance === "number" ? item.relevance : existing.relevance,
    });
  }

  return {
    currentStage: patch.currentStage ?? base.currentStage,
    complete: patch.complete ?? base.complete,
    steps: mergedSteps,
    sources: Array.from(sourceMap.values()),
    gaps: patch.gaps ?? base.gaps,
    gapRound: patch.gapRound ?? base.gapRound,
    reportMarkdown: patch.reportMarkdown ?? base.reportMarkdown,
  };
}

function inferCurrentStage(snapshot: Snapshot): StageKey {
  if (snapshot.currentStage) {
    return snapshot.currentStage;
  }
  if (snapshot.complete || snapshot.reportMarkdown) {
    return "report";
  }
  if (snapshot.gaps.length > 0) {
    return "gap_analysis";
  }
  if (snapshot.sources.some((source) => source.status === "analyzed")) {
    return "synthesize";
  }
  if (snapshot.sources.some((source) => source.status === "extracted")) {
    return "analyze";
  }
  if (snapshot.sources.length > 0) {
    return "read";
  }
  return "plan";
}

function getStatusClass(status: PipelineStatus): string {
  if (status === "done") {
    return "border-[#2f8f5b]/40 bg-[#123424] text-[#b8f7d8]";
  }
  if (status === "running") {
    return "border-[#2c4b6f] bg-[#12273a] text-[#a5d8ff]";
  }
  return "border-[#2a2a33] bg-[#15151d] text-gray-400";
}

function getSourceStatusClass(status: SourceStatus): string {
  if (status === "analyzed") {
    return "border-[#2f8f5b]/40 bg-[#123424] text-[#b8f7d8]";
  }
  if (status === "extracted") {
    return "border-[#2c4b6f] bg-[#12273a] text-[#a5d8ff]";
  }
  return "border-[#2a2a33] bg-[#15151d] text-gray-300";
}

function getEvidenceTag(tag: EvidenceTag): { label: string; className: string } {
  if (tag === "supporting") {
    return { label: "✅ Supporting", className: "border-[#2f8f5b]/40 bg-[#123424] text-[#b8f7d8]" };
  }
  if (tag === "contrasting") {
    return { label: "⚠️ Contrasting", className: "border-[#7a4a1e]/50 bg-[#2a1d14] text-[#facc8f]" };
  }
  return { label: "💬 Mentioning", className: "border-[#3c3c47] bg-[#1a1a23] text-gray-300" };
}

export default function ResearchPanel({ messages, liveEvents = [], onSendDirection, disabled = false }: Props) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  const snapshot = useMemo(() => {
    let next = EMPTY_SNAPSHOT;

    for (const message of messages) {
      if (message.role !== "assistant") {
        continue;
      }
      const objects = extractJsonObjects(message.content);
      for (const obj of objects) {
        next = mergeSnapshots(next, parsePatch(obj));
      }
    }

    for (const event of liveEvents) {
      next = mergeSnapshots(next, parsePatch(event));
    }

    return next;
  }, [liveEvents, messages]);

  const currentStage = inferCurrentStage(snapshot);
  const currentIndex = STAGES.findIndex((step) => step.key === currentStage);

  const pipelineSteps = STAGES.map((step, index) => {
    const fromData = snapshot.steps[step.key];
    let status = fromData?.status;

    if (!status) {
      if (snapshot.complete) {
        status = "done";
      } else if (index < currentIndex) {
        status = "done";
      } else if (index === currentIndex) {
        status = "running";
      } else {
        status = "pending";
      }
    }

    return {
      ...step,
      status,
      detail: fromData?.detail || step.detail,
    };
  });

  const gapStage = pipelineSteps.find((step) => step.key === "gap_analysis");
  const showGapCards = gapStage?.status === "running" && snapshot.gaps.length > 0;
  const reportReady = snapshot.complete || Boolean(snapshot.reportMarkdown.trim());

  const sortedSources = [...snapshot.sources].sort((a, b) => {
    const aScore = typeof a.relevance === "number" ? a.relevance : -1;
    const bScore = typeof b.relevance === "number" ? b.relevance : -1;
    return bScore - aScore;
  });

  async function copyReport() {
    if (!snapshot.reportMarkdown.trim() || typeof navigator === "undefined" || !navigator.clipboard) {
      setCopyState("error");
      return;
    }
    try {
      await navigator.clipboard.writeText(snapshot.reportMarkdown);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-[#24242c] bg-[#0d0d14] text-gray-200">
      <div className="border-b border-[#24242c] px-4 py-3">
        <p className="text-xs uppercase tracking-[0.12em] text-gray-500">Research Panel</p>
        <h3 className="text-sm font-semibold text-gray-100">Live progress + direction</h3>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <section className="rounded-xl border border-[#24242c] bg-[#11111a] p-3">
          <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-400">Pipeline Progress</h4>
          <div className="mt-3 space-y-2">
            {pipelineSteps.map((step, index) => (
              <div key={step.key} className="flex gap-3">
                <div className="flex w-6 flex-col items-center pt-0.5">
                  <span className="text-sm">{step.icon}</span>
                  {index < pipelineSteps.length - 1 ? <span className="mt-1 h-full w-px bg-[#2a2a33]" /> : null}
                </div>
                <div className="min-w-0 flex-1 rounded-lg border border-[#24242c] bg-[#0f0f18] p-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-gray-100">{step.label}</p>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${getStatusClass(step.status)}`}>
                      {step.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-400">{step.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {showGapCards && (
          <section className="rounded-xl border border-[#24242c] bg-[#11111a] p-3">
            <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-400">Gap Analysis</h4>
            <p className="mt-2 text-sm text-gray-200">Round {snapshot.gapRound} — Found limited coverage on:</p>
            <div className="mt-3 grid gap-2">
              {snapshot.gaps.map((gap, index) => (
                <button
                  key={`${gap}-${index}`}
                  type="button"
                  disabled={disabled}
                  onClick={() => onSendDirection?.(`Investigate this gap in the next research round: ${gap}`)}
                  className="rounded-xl border border-[#24242c] bg-[#0f0f17] px-3 py-2 text-left text-sm text-gray-100 transition-colors hover:border-[#3a3a44] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  [🔍 {gap}]
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onSendDirection?.("Skip gap analysis for now — enough coverage. Continue to synthesis and final report.")}
              className="mt-3 rounded-lg border border-[#2a2a33] bg-[#15151d] px-3 py-1.5 text-xs text-gray-200 transition-colors hover:border-[#3a3a44] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Skip — enough coverage
            </button>
          </section>
        )}

        <section className="rounded-xl border border-[#24242c] bg-[#11111a] p-3">
          <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-400">Sources Feed</h4>
          <div className="mt-3 max-h-[36vh] space-y-2 overflow-y-auto pr-1">
            {sortedSources.length === 0 ? (
              <p className="text-xs text-gray-500">No sources captured yet.</p>
            ) : (
              sortedSources.map((source) => {
                const evidenceTag = getEvidenceTag(source.evidence);
                return (
                  <details key={source.id} className="rounded-lg border border-[#24242c] bg-[#0f0f17]">
                    <summary className="cursor-pointer list-none px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="min-w-0 flex-1 truncate text-sm text-gray-100">{source.title}</p>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${getSourceStatusClass(source.status)}`}>
                          {source.status}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        {source.url ? (
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="max-w-full truncate text-[#7ad4ff] underline decoration-[#2e7da3] underline-offset-2 hover:text-[#9ce2ff]"
                          >
                            {source.url}
                          </a>
                        ) : (
                          <span className="text-gray-500">No URL provided</span>
                        )}
                        {typeof source.relevance === "number" ? (
                          <span className="rounded-full border border-[#2a2a33] bg-[#15151d] px-2 py-0.5 text-[10px] text-gray-300">
                            relevance {source.relevance.toFixed(2)}
                          </span>
                        ) : null}
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] ${evidenceTag.className}`}>{evidenceTag.label}</span>
                      </div>
                    </summary>
                    {source.excerpt ? (
                      <div className="border-t border-[#24242c] px-3 py-2 text-xs text-gray-300">{source.excerpt}</div>
                    ) : (
                      <div className="border-t border-[#24242c] px-3 py-2 text-xs text-gray-500">No excerpt available yet.</div>
                    )}
                  </details>
                );
              })
            )}
          </div>
        </section>

        {reportReady && (
          <section className="rounded-xl border border-[#24242c] bg-[#11111a] p-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-400">Report Preview</h4>
              <button
                type="button"
                onClick={() => void copyReport()}
                className="rounded-lg border border-[#2a2a33] bg-[#15151d] px-2.5 py-1 text-xs text-gray-200 transition-colors hover:border-[#3a3a44]"
              >
                Export
              </button>
            </div>
            {copyState !== "idle" ? (
              <p className={`mt-2 text-xs ${copyState === "copied" ? "text-[#9ff1c5]" : "text-[#fda4af]"}`}>
                {copyState === "copied" ? "Copied markdown to clipboard." : "Could not copy markdown."}
              </p>
            ) : null}
            <div className="chat-markdown mt-3 max-h-[42vh] overflow-y-auto rounded-lg border border-[#24242c] bg-[#0f0f17] p-3 text-sm">
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
                {snapshot.reportMarkdown || "Waiting for final report output..."}
              </ReactMarkdown>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
