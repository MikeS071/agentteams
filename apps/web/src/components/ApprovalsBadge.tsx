"use client";

import { useEffect, useMemo, useState } from "react";
import {
  APPROVALS_STORAGE_KEY,
  HANDS_SSE_EVENT_NAMES,
  hydrateApprovalsFromStorage,
  parseApprovalEvent,
  removeApprovalItem,
  upsertApprovalItem,
} from "@/lib/approvals";

export default function ApprovalsBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const initial = hydrateApprovalsFromStorage();
    setCount(initial.length);

    const source = new EventSource("/api/hands/events");
    const handleEvent = (event: MessageEvent) => {
      const parsed = parseApprovalEvent(event.data);
      if (!parsed) {
        return;
      }

      setCount((currentCount) => {
        const list = hydrateApprovalsFromStorage();
        const next =
          parsed.type === "required"
            ? upsertApprovalItem(list, parsed.item)
            : removeApprovalItem(list, parsed.handId, parsed.actionId);

        try {
          window.localStorage.setItem(APPROVALS_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore write failures
        }

        if (next.length === currentCount) {
          return currentCount;
        }

        return next.length;
      });
    };
    source.onmessage = handleEvent;
    HANDS_SSE_EVENT_NAMES.forEach((eventName) => {
      source.addEventListener(eventName, handleEvent as EventListener);
    });

    source.onerror = () => {
      // EventSource reconnects automatically.
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== APPROVALS_STORAGE_KEY) {
        return;
      }
      const latest = hydrateApprovalsFromStorage();
      setCount(latest.length);
    };

    window.addEventListener("storage", handleStorage);

    return () => {
      HANDS_SSE_EVENT_NAMES.forEach((eventName) => {
        source.removeEventListener(eventName, handleEvent as EventListener);
      });
      source.close();
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const hidden = useMemo(() => count <= 0, [count]);
  if (hidden) {
    return null;
  }

  return (
    <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[#f97316] px-1.5 py-0.5 text-[11px] font-semibold leading-none text-black">
      {count > 99 ? "99+" : count}
    </span>
  );
}
