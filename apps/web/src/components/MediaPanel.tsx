"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type ToolExecution = {
  output?: string;
};

type MediaMessage = {
  id?: string;
  role: "user" | "assistant" | "system";
  content: string;
  tools?: ToolExecution[];
};

type MediaPanelProps = {
  messages: MediaMessage[];
  isGenerating?: boolean;
};

type MediaKind = "image" | "video";

type MediaAsset = {
  id: string;
  url: string;
  kind: MediaKind;
};

type TimelineFrame = {
  id: string;
  label: string;
  seconds: number;
  mediaUrl?: string;
  thumbnailUrl?: string;
};

type ClipItem = {
  id: string;
  title: string;
  startLabel?: string;
  endLabel?: string;
  startSeconds?: number;
  endSeconds?: number;
  mediaUrl?: string;
  thumbnailUrl?: string;
};

type ParsedMediaData = {
  assets: MediaAsset[];
  clips: ClipItem[];
  frames: TimelineFrame[];
  beforeAfter?: {
    before: string;
    after: string;
  };
};

const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "m4v", "ogv"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"]);

function parseTimeToSeconds(value: string): number | null {
  const parts = value.trim().split(":").map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) {
    return null;
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return null;
}

function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "00:00";
  }
  const rounded = Math.floor(seconds);
  const minutes = Math.floor(rounded / 60);
  const remaining = rounded % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function getUrlExtension(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const lastPart = pathname.split("/").pop() || "";
    const ext = lastPart.split(".").pop() || "";
    return ext.toLowerCase();
  } catch {
    return "";
  }
}

function classifyMedia(url: string): MediaKind | null {
  const extension = getUrlExtension(url);
  if (VIDEO_EXTENSIONS.has(extension)) {
    return "video";
  }
  if (IMAGE_EXTENSIONS.has(extension)) {
    return "image";
  }
  return null;
}

function cleanUrl(raw: string): string {
  return raw.trim().replace(/[),.;!?]+$/, "");
}

function extractUrls(text: string): string[] {
  const values: string[] = [];
  const patterns = [
    /!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/gi,
    /\[[^\]]+]\((https?:\/\/[^)\s]+)\)/gi,
    /(https?:\/\/[^\s<>"`]+)/gi,
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match = pattern.exec(text);
    while (match) {
      const candidate = cleanUrl(match[1] || match[0] || "");
      if (candidate) {
        values.push(candidate);
      }
      match = pattern.exec(text);
    }
  }

  return Array.from(new Set(values));
}

function parseBeforeAfterPair(text: string): { before?: string; after?: string } {
  const beforeMatch = text.match(/before\s*[:=-]\s*(https?:\/\/[^\s)]+)/i);
  const afterMatch = text.match(/after\s*[:=-]\s*(https?:\/\/[^\s)]+)/i);

  return {
    before: beforeMatch ? cleanUrl(beforeMatch[1]) : undefined,
    after: afterMatch ? cleanUrl(afterMatch[1]) : undefined,
  };
}

function parseClipEntries(text: string, fallbackMediaUrl?: string): ClipItem[] {
  const blocks = text.split(/\n(?=(?:[-*]\s*)?\**clip\s*#?\d+)/i);
  const clips: ClipItem[] = [];

  blocks.forEach((block, index) => {
    const header = block.match(/(?:^|\n)(?:[-*]\s*)?\**clip\s*#?(\d+)?\**\s*:?\s*([^\n]*)/i);
    if (!header) {
      return;
    }

    const clipNumber = header[1];
    const titleRaw = header[2]?.trim();
    const title = titleRaw || `Clip ${clipNumber || String(index + 1)}`;
    const rangeMatch =
      block.match(/(?:timestamps?|time\s*range)\s*[:=-]\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–]\s*(\d{1,2}:\d{2}(?::\d{2})?)/i) ||
      block.match(/(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–]\s*(\d{1,2}:\d{2}(?::\d{2})?)/i);

    const startLabel = rangeMatch?.[1];
    const endLabel = rangeMatch?.[2];
    const startSeconds = startLabel ? parseTimeToSeconds(startLabel) ?? undefined : undefined;
    const endSeconds = endLabel ? parseTimeToSeconds(endLabel) ?? undefined : undefined;

    const urls = extractUrls(block);
    const thumbnailUrl = urls.find((url) => classifyMedia(url) === "image");
    const blockVideo = urls.find((url) => classifyMedia(url) === "video");

    clips.push({
      id: `clip-${clipNumber || index + 1}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      title,
      startLabel,
      endLabel,
      startSeconds,
      endSeconds,
      mediaUrl: blockVideo || fallbackMediaUrl,
      thumbnailUrl,
    });
  });

  return clips;
}

function parseTimelineFrames(text: string, mediaUrl?: string): TimelineFrame[] {
  const rangePattern = /(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–]\s*(\d{1,2}:\d{2}(?::\d{2})?)/g;
  const frames: TimelineFrame[] = [];

  let match = rangePattern.exec(text);
  while (match) {
    const startLabel = match[1];
    const endLabel = match[2];
    const startSeconds = parseTimeToSeconds(startLabel);
    const endSeconds = parseTimeToSeconds(endLabel);
    if (startSeconds === null || endSeconds === null) {
      match = rangePattern.exec(text);
      continue;
    }

    frames.push({
      id: `range-start-${startSeconds}-${endSeconds}`,
      label: startLabel,
      seconds: startSeconds,
      mediaUrl,
    });
    frames.push({
      id: `range-end-${startSeconds}-${endSeconds}`,
      label: endLabel,
      seconds: endSeconds,
      mediaUrl,
    });

    match = rangePattern.exec(text);
  }

  return frames;
}

function parseMediaData(messages: MediaMessage[]): ParsedMediaData {
  const assets: MediaAsset[] = [];
  const clips: ClipItem[] = [];
  const frames: TimelineFrame[] = [];
  let beforeCandidate: string | undefined;
  let afterCandidate: string | undefined;

  messages.forEach((message, index) => {
    if (message.role !== "assistant") {
      return;
    }

    const sourceTexts = [message.content, ...(message.tools?.map((tool) => tool.output || "") || [])].filter(Boolean);

    sourceTexts.forEach((textSource, sourceIndex) => {
      const urls = extractUrls(textSource);
      const mediaUrls = urls.filter((url) => classifyMedia(url) !== null);

      mediaUrls.forEach((url) => {
        const kind = classifyMedia(url);
        if (!kind) {
          return;
        }
        assets.push({
          id: `asset-${index}-${sourceIndex}-${url}`,
          url,
          kind,
        });
      });

      const fallbackMediaUrl = mediaUrls.find((url) => classifyMedia(url) === "video") || mediaUrls[0];

      const pair = parseBeforeAfterPair(textSource);
      if (pair.before) {
        beforeCandidate = pair.before;
      }
      if (pair.after) {
        afterCandidate = pair.after;
      }

      const parsedClips = parseClipEntries(textSource, fallbackMediaUrl);
      clips.push(...parsedClips);

      const parsedFrames = parseTimelineFrames(textSource, fallbackMediaUrl);
      frames.push(...parsedFrames);
    });
  });

  const uniqueAssets = Array.from(new Map(assets.map((asset) => [asset.url, asset])).values());

  if ((!beforeCandidate || !afterCandidate) && uniqueAssets.length > 1) {
    const maybeBefore = uniqueAssets.find((asset) => asset.kind === "image" && /before/i.test(asset.url));
    const maybeAfter = uniqueAssets.find((asset) => asset.kind === "image" && /after/i.test(asset.url));
    if (maybeBefore && maybeAfter) {
      beforeCandidate = beforeCandidate || maybeBefore.url;
      afterCandidate = afterCandidate || maybeAfter.url;
    }
  }

  const clipFrames = clips.flatMap((clip) => {
    const generated: TimelineFrame[] = [];
    if (typeof clip.startSeconds === "number") {
      generated.push({
        id: `${clip.id}-start`,
        label: clip.startLabel || formatSeconds(clip.startSeconds),
        seconds: clip.startSeconds,
        mediaUrl: clip.mediaUrl,
        thumbnailUrl: clip.thumbnailUrl,
      });
    }
    if (typeof clip.endSeconds === "number") {
      generated.push({
        id: `${clip.id}-end`,
        label: clip.endLabel || formatSeconds(clip.endSeconds),
        seconds: clip.endSeconds,
        mediaUrl: clip.mediaUrl,
        thumbnailUrl: clip.thumbnailUrl,
      });
    }
    return generated;
  });

  const allFrames = [...clipFrames, ...frames];
  const uniqueFrames = Array.from(new Map(allFrames.map((frame) => [frame.id, frame])).values()).slice(0, 24);

  if (uniqueFrames.length === 0 && uniqueAssets.length > 0) {
    uniqueFrames.push({
      id: "default-frame-0",
      label: "00:00",
      seconds: 0,
      mediaUrl: uniqueAssets[0].url,
      thumbnailUrl: uniqueAssets.find((asset) => asset.kind === "image")?.url,
    });
  }

  return {
    assets: uniqueAssets,
    clips: Array.from(new Map(clips.map((clip) => [clip.id, clip])).values()),
    frames: uniqueFrames,
    beforeAfter:
      beforeCandidate && afterCandidate
        ? {
            before: beforeCandidate,
            after: afterCandidate,
          }
        : undefined,
  };
}

export default function MediaPanel({ messages, isGenerating = false }: MediaPanelProps) {
  const parsed = useMemo(() => parseMediaData(messages), [messages]);
  const [selectedAssetUrl, setSelectedAssetUrl] = useState<string | null>(null);
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [previewDuration, setPreviewDuration] = useState(0);
  const [trimStartPercent, setTrimStartPercent] = useState(0);
  const [trimEndPercent, setTrimEndPercent] = useState(100);
  const [comparePosition, setComparePosition] = useState(50);
  const [format, setFormat] = useState("MP4");
  const [quality, setQuality] = useState("High");
  const [dimensions, setDimensions] = useState("1080x1920");
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const fallbackAsset = parsed.assets[0]?.url ?? null;
    if (!selectedAssetUrl) {
      setSelectedAssetUrl(fallbackAsset);
      return;
    }
    const exists = parsed.assets.some((asset) => asset.url === selectedAssetUrl);
    if (!exists) {
      setSelectedAssetUrl(fallbackAsset);
    }
  }, [parsed.assets, selectedAssetUrl]);

  const selectedAsset = useMemo(() => {
    return parsed.assets.find((asset) => asset.url === selectedAssetUrl) || parsed.assets[0];
  }, [parsed.assets, selectedAssetUrl]);

  const trimStartSeconds = previewDuration > 0 ? (trimStartPercent / 100) * previewDuration : 0;
  const trimEndSeconds = previewDuration > 0 ? (trimEndPercent / 100) * previewDuration : 0;

  useEffect(() => {
    if (selectedAsset?.kind !== "video") {
      setPreviewDuration(0);
      setTrimStartPercent(0);
      setTrimEndPercent(100);
      return;
    }

    setTrimStartPercent(0);
    setTrimEndPercent(100);
  }, [selectedAsset?.kind, selectedAsset?.url]);

  useEffect(() => {
    if (selectedAsset?.kind !== "video" || !videoRef.current || previewDuration <= 0) {
      return;
    }

    const element = videoRef.current;
    const maxTime = (trimEndPercent / 100) * previewDuration;
    const onTimeUpdate = () => {
      if (element.currentTime > maxTime) {
        element.currentTime = maxTime;
        element.pause();
      }
    };

    element.addEventListener("timeupdate", onTimeUpdate);
    return () => {
      element.removeEventListener("timeupdate", onTimeUpdate);
    };
  }, [previewDuration, selectedAsset?.kind, trimEndPercent]);

  const hasMedia = parsed.assets.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden border-l border-[#1a1a1f] bg-[#090a0f] p-3 sm:p-4">
      <section className="flex min-h-[250px] flex-[2] flex-col rounded-xl border border-[#242733] bg-[#0d1018] p-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">Preview</h3>
          {isGenerating && <span className="text-[11px] text-[#9fb7ff]">Rendering updates...</span>}
        </div>

        <div className="relative flex min-h-0 flex-1 items-center justify-center rounded-lg border border-[#2b2f3d] bg-[#05070c] p-3">
          {parsed.beforeAfter ? (
            <div className="flex h-full w-full flex-col gap-3">
              <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md border border-[#303547] bg-black">
                <img src={parsed.beforeAfter.before} alt="Before preview" className="h-full w-full object-contain" />
                <div
                  className="pointer-events-none absolute inset-0 overflow-hidden"
                  style={{ clipPath: `inset(0 ${100 - comparePosition}% 0 0)` }}
                >
                  <img src={parsed.beforeAfter.after} alt="After preview" className="h-full w-full object-contain" />
                </div>
                <div className="pointer-events-none absolute inset-y-0" style={{ left: `${comparePosition}%` }}>
                  <div className="h-full w-[2px] bg-white/80 shadow-[0_0_12px_rgba(255,255,255,0.6)]" />
                </div>
              </div>

              <label className="text-xs text-gray-300">
                Before/After:
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={comparePosition}
                  onChange={(event) => setComparePosition(Number(event.target.value))}
                  className="mt-1 w-full accent-[#7aa2ff]"
                />
              </label>
            </div>
          ) : hasMedia ? (
            selectedAsset?.kind === "video" ? (
              <video
                key={selectedAsset.url}
                ref={videoRef}
                src={selectedAsset.url}
                controls
                className="max-h-full w-full rounded-md bg-black object-contain"
                onLoadedMetadata={(event) => {
                  setPreviewDuration(event.currentTarget.duration || 0);
                }}
              />
            ) : (
              <img src={selectedAsset?.url} alt="Generated media preview" className="max-h-full w-full rounded-md object-contain" />
            )
          ) : (
            <p className="text-sm text-gray-500">Generated media will appear here as assistant responses stream in.</p>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-[#242733] bg-[#0d1018] p-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">Timeline / Storyboard</h3>
          {selectedAsset?.kind === "video" && previewDuration > 0 && (
            <span className="text-[11px] text-gray-400">
              {formatSeconds(trimStartSeconds)} - {formatSeconds(trimEndSeconds || previewDuration)}
            </span>
          )}
        </div>

        <div className="flex gap-2 overflow-x-auto pb-2">
          {parsed.frames.length > 0 ? (
            parsed.frames.map((frame) => (
              <button
                key={frame.id}
                type="button"
                onClick={() => {
                  setSelectedFrameId(frame.id);
                  if (frame.mediaUrl) {
                    setSelectedAssetUrl(frame.mediaUrl);
                  }
                  if (videoRef.current) {
                    videoRef.current.currentTime = frame.seconds;
                  }
                }}
                className={`group min-w-[96px] overflow-hidden rounded-md border text-left transition-colors ${
                  selectedFrameId === frame.id
                    ? "border-[#7aa2ff] bg-[#16213a]"
                    : "border-[#2c3040] bg-[#121624] hover:border-[#4f638f]"
                }`}
              >
                <div className="flex h-14 items-center justify-center bg-[#080b13] text-[11px] text-gray-400">
                  {frame.thumbnailUrl ? (
                    <img src={frame.thumbnailUrl} alt={frame.label} className="h-full w-full object-cover" />
                  ) : (
                    <span>Frame</span>
                  )}
                </div>
                <div className="px-2 py-1 text-[11px] text-gray-200">{frame.label}</div>
              </button>
            ))
          ) : (
            <div className="rounded-md border border-dashed border-[#2c3040] px-3 py-4 text-xs text-gray-500">
              Add clip timestamps in assistant output to populate the storyboard.
            </div>
          )}
        </div>

        <div className="mt-2 space-y-2">
          <label className="block text-[11px] text-gray-400">
            Trim start
            <input
              type="range"
              min={0}
              max={100}
              value={trimStartPercent}
              onChange={(event) => {
                const value = Number(event.target.value);
                setTrimStartPercent(Math.min(value, trimEndPercent - 1));
              }}
              className="mt-1 w-full accent-[#4ade80]"
            />
          </label>
          <label className="block text-[11px] text-gray-400">
            Trim end
            <input
              type="range"
              min={0}
              max={100}
              value={trimEndPercent}
              onChange={(event) => {
                const value = Number(event.target.value);
                setTrimEndPercent(Math.max(value, trimStartPercent + 1));
              }}
              className="mt-1 w-full accent-[#f59e0b]"
            />
          </label>
        </div>
      </section>

      <section className="rounded-xl border border-[#242733] bg-[#0d1018] p-3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">Export Options</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label className="text-xs text-gray-300">
            Format
            <select
              value={format}
              onChange={(event) => setFormat(event.target.value)}
              className="mt-1 h-8 w-full rounded-md border border-[#2f3548] bg-[#0f1320] px-2 text-xs text-gray-200"
            >
              <option value="MP4">MP4</option>
              <option value="GIF">GIF</option>
              <option value="WebM">WebM</option>
            </select>
          </label>
          <label className="text-xs text-gray-300">
            Quality
            <select
              value={quality}
              onChange={(event) => setQuality(event.target.value)}
              className="mt-1 h-8 w-full rounded-md border border-[#2f3548] bg-[#0f1320] px-2 text-xs text-gray-200"
            >
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
          </label>
          <label className="text-xs text-gray-300">
            Dimensions
            <select
              value={dimensions}
              onChange={(event) => setDimensions(event.target.value)}
              className="mt-1 h-8 w-full rounded-md border border-[#2f3548] bg-[#0f1320] px-2 text-xs text-gray-200"
            >
              <option value="1080x1920">1080x1920</option>
              <option value="1080x1080">1080x1080</option>
              <option value="1920x1080">1920x1080</option>
              <option value="720x1280">720x1280</option>
            </select>
          </label>
        </div>
      </section>

      <section className="min-h-0 flex-1 rounded-xl border border-[#242733] bg-[#0d1018] p-3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">Clip Library</h3>
        <div className="grid max-h-full grid-cols-2 gap-2 overflow-y-auto pr-1">
          {parsed.clips.length > 0 ? (
            parsed.clips.map((clip) => (
              <button
                key={clip.id}
                type="button"
                onClick={() => {
                  setSelectedClipId(clip.id);
                  setSelectedAssetUrl(clip.mediaUrl || clip.thumbnailUrl || null);
                }}
                className={`rounded-md border p-2 text-left transition-colors ${
                  selectedClipId === clip.id
                    ? "border-[#7aa2ff] bg-[#16213a]"
                    : "border-[#2c3040] bg-[#121624] hover:border-[#4f638f]"
                }`}
              >
                <div className="mb-1 flex h-16 items-center justify-center overflow-hidden rounded bg-[#070a12]">
                  {clip.thumbnailUrl ? (
                    <img src={clip.thumbnailUrl} alt={clip.title} className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-[11px] text-gray-500">No thumbnail</span>
                  )}
                </div>
                <p className="line-clamp-1 text-xs font-medium text-gray-100">{clip.title}</p>
                <p className="text-[11px] text-gray-400">
                  {clip.startLabel && clip.endLabel ? `${clip.startLabel} - ${clip.endLabel}` : "Timestamp pending"}
                </p>
              </button>
            ))
          ) : (
            <p className="col-span-2 text-xs text-gray-500">No clips yet. Ask the assistant to generate clip plans with timestamps.</p>
          )}
        </div>
      </section>
    </div>
  );
}
