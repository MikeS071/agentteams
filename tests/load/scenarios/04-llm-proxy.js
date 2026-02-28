import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

import { config, randomTenantId } from "../lib/config.js";

const llmProxySuccess = new Rate("llm_proxy_success_rate");
const llmProxyLatency = new Trend("llm_proxy_latency_ms", true);
const llmPromptTokens = new Counter("llm_prompt_tokens_total");
const llmCompletionTokens = new Counter("llm_completion_tokens_total");
const llmTotalTokens = new Counter("llm_total_tokens_total");

export const options = {
  scenarios: {
    llm_proxy_requests: {
      executor: "constant-vus",
      vus: Number(__ENV.LLM_VUS || 100),
      duration: __ENV.LLM_DURATION || "10m",
      gracefulStop: "30s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
    llm_proxy_success_rate: ["rate>0.95"],
    llm_proxy_latency_ms: ["p(99)<500"],
  },
};

export default function () {
  if (config.tenantIds.length === 0) {
    throw new Error("TENANT_IDS is required for LLM proxy scenario (comma-separated UUID list).");
  }

  const tenantId = randomTenantId(__VU - 1);

  const payload = {
    model: config.llmModel,
    messages: [
      { role: "system", content: "You are a concise assistant." },
      { role: "user", content: "Return a short status: healthy." },
    ],
    max_tokens: Number(__ENV.LLM_MAX_TOKENS || "64"),
    temperature: 0,
  };

  const res = http.post(`${config.apiBaseUrl}/v1/chat/completions`, JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json",
      "X-Tenant-ID": tenantId,
    },
    tags: { endpoint: "llm-proxy" },
  });

  const adjustedLatency = Math.max(0, res.timings.duration - config.inferenceBudgetMs);
  llmProxyLatency.add(adjustedLatency);

  const ok = check(res, {
    "llm proxy request ok": (r) => r.status === 200,
    "llm proxy usage returned": (r) => {
      const body = r.json();
      return Boolean(body && body.usage && Number.isFinite(body.usage.total_tokens));
    },
  });

  if (ok) {
    const usage = res.json().usage;
    llmPromptTokens.add(Number(usage.prompt_tokens || 0));
    llmCompletionTokens.add(Number(usage.completion_tokens || 0));
    llmTotalTokens.add(Number(usage.total_tokens || 0));
  }

  llmProxySuccess.add(ok ? 1 : 0);
  sleep(Number(__ENV.LLM_THINK_TIME_SECONDS || "0.2"));
}
