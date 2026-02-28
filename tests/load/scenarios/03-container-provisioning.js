import http from "k6/http";
import { check, fail, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

import { config, randomTenantId } from "../lib/config.js";

const containerProvisionSuccess = new Rate("container_provision_success_rate");
const containerStartupLatency = new Trend("container_startup_latency_ms", true);

export const options = {
  scenarios: {
    container_provisioning: {
      executor: "constant-vus",
      vus: Number(__ENV.CONTAINER_VUS || 10),
      duration: __ENV.CONTAINER_DURATION || "10m",
      gracefulStop: "30s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
    container_provision_success_rate: ["rate>0.9"],
    container_startup_latency_ms: ["p(95)<30000"],
  },
};

export default function () {
  if (config.tenantIds.length === 0) {
    fail("TENANT_IDS is required for container provisioning scenario (comma-separated UUID list).");
  }

  const tenantId = randomTenantId(__VU - 1);
  const start = Date.now();

  const resumeRes = http.post(`${config.apiBaseUrl}/api/tenants/${tenantId}/resume`, null, {
    tags: { endpoint: "tenant-resume" },
  });

  const latency = Date.now() - start;
  containerStartupLatency.add(latency);

  const ok = check(resumeRes, {
    "resume accepted": (r) => r.status === 200,
  });

  containerProvisionSuccess.add(ok ? 1 : 0);
  sleep(Number(__ENV.CONTAINER_THINK_TIME_SECONDS || "1"));
}
