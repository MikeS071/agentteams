import http from "k6/http";
import { check } from "k6";

import { config } from "./config.js";

const shortMessages = [
  "Hello",
  "Status update?",
  "Summarize this in one sentence.",
  "List 3 risks.",
];

const mediumMessages = [
  "Give me a short project status summary with blockers and next actions.",
  "Draft a concise test plan for a multi-tenant SaaS release this week.",
  "Review this feature idea and suggest implementation milestones.",
];

const longMessages = [
  "I need a detailed rollout plan for load-testing a multi-tenant platform with 50 concurrent tenants, including setup, execution phases, risk mitigation, and rollback steps.",
  "Create a structured troubleshooting guide for intermittent authentication latency spikes, including likely root causes, SQL checks, API checks, and caching checks.",
];

export function randomMessage() {
  const bucket = Math.random();
  if (bucket < 0.5) {
    return shortMessages[Math.floor(Math.random() * shortMessages.length)];
  }
  if (bucket < 0.85) {
    return mediumMessages[Math.floor(Math.random() * mediumMessages.length)];
  }
  return longMessages[Math.floor(Math.random() * longMessages.length)];
}

export function sendChatMessage(message, conversationId = "") {
  const payload = { message };
  if (conversationId) {
    payload.conversationId = conversationId;
  }

  const res = http.post(`${config.webBaseUrl}/api/chat`, JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    tags: { endpoint: "web-chat" },
  });

  const ok = check(res, {
    "chat response ok": (r) => r.status === 200,
    "chat has message": (r) => {
      const body = r.json();
      return Boolean(body && body.message && body.message.content);
    },
  });

  let nextConversationId = conversationId;
  if (ok) {
    const body = res.json();
    nextConversationId = body.conversationId || conversationId;
  }

  return { ok, res, conversationId: nextConversationId };
}

export function sendInboundMessage(tenantId, message, metadata = {}) {
  const res = http.post(
    `${config.apiBaseUrl}/api/channels/inbound`,
    JSON.stringify({
      tenant_id: tenantId,
      content: message,
      channel: "web",
      metadata,
    }),
    {
      headers: { "Content-Type": "application/json" },
      tags: { endpoint: "channels-inbound" },
    }
  );

  const ok = check(res, {
    "inbound ok": (r) => r.status === 200,
  });

  return { ok, res };
}
