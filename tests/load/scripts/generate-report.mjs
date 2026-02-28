#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const resultsDir = process.argv[2] || path.resolve("tests/load/results");
const outputPath = process.argv[3] || path.resolve(resultsDir, "loadtest-report.md");

if (!fs.existsSync(resultsDir)) {
  console.error(`Results directory not found: ${resultsDir}`);
  process.exit(1);
}

const summaryFiles = fs
  .readdirSync(resultsDir)
  .filter((file) => file.endsWith(".summary.json"))
  .sort();

if (summaryFiles.length === 0) {
  console.error(`No .summary.json files found in ${resultsDir}`);
  process.exit(1);
}

function fmtNumber(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }
  if (Math.abs(value) >= 1000) {
    return value.toFixed(0);
  }
  if (Math.abs(value) >= 100) {
    return value.toFixed(1);
  }
  return value.toFixed(2);
}

function extractMetric(summary, metricName) {
  const metric = summary.metrics?.[metricName];
  if (!metric) {
    return null;
  }
  const values = metric.values || {};
  return {
    avg: values.avg,
    p95: values["p(95)"],
    p99: values["p(99)"],
    rate: values.rate,
    count: values.count,
    fails: values.fails,
    passes: values.passes,
    thresholds: metric.thresholds || {},
  };
}

function thresholdStatus(thresholds) {
  const items = Object.entries(thresholds || {});
  if (items.length === 0) {
    return "n/a";
  }
  const failed = items.find(([, data]) => data && data.ok === false);
  return failed ? "fail" : "pass";
}

const lines = [];
lines.push("# Load Test Report");
lines.push("");
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push("");

for (const file of summaryFiles) {
  const fullPath = path.join(resultsDir, file);
  const summary = JSON.parse(fs.readFileSync(fullPath, "utf8"));

  lines.push(`## ${file}`);
  lines.push("");

  const httpReq = extractMetric(summary, "http_req_duration");
  const httpFail = extractMetric(summary, "http_req_failed");
  const checks = extractMetric(summary, "checks");

  lines.push("| Metric | Avg | p95 | p99 | Rate | Thresholds |");
  lines.push("|---|---:|---:|---:|---:|---|");

  if (httpReq) {
    lines.push(
      `| http_req_duration (ms) | ${fmtNumber(httpReq.avg)} | ${fmtNumber(httpReq.p95)} | ${fmtNumber(httpReq.p99)} | n/a | ${thresholdStatus(httpReq.thresholds)} |`
    );
  }

  if (httpFail) {
    lines.push(
      `| http_req_failed | n/a | n/a | n/a | ${fmtNumber(httpFail.rate)} | ${thresholdStatus(httpFail.thresholds)} |`
    );
  }

  if (checks) {
    lines.push(
      `| checks | n/a | n/a | n/a | ${fmtNumber(checks.rate)} | ${thresholdStatus(checks.thresholds)} |`
    );
  }

  const customMetricNames = [
    "auth_duration",
    "onboarding_flow_duration",
    "onboarding_success_rate",
    "chat_session_success_rate",
    "ws_session_success_rate",
    "container_startup_latency_ms",
    "container_provision_success_rate",
    "llm_proxy_latency_ms",
    "llm_proxy_success_rate",
    "llm_total_tokens_total",
  ];

  for (const metricName of customMetricNames) {
    const metric = extractMetric(summary, metricName);
    if (!metric) {
      continue;
    }

    lines.push(
      `| ${metricName} | ${fmtNumber(metric.avg)} | ${fmtNumber(metric.p95)} | ${fmtNumber(metric.p99)} | ${fmtNumber(metric.rate)} | ${thresholdStatus(metric.thresholds)} |`
    );
  }

  lines.push("");
}

fs.writeFileSync(outputPath, `${lines.join("\n")}\n`);
console.log(`Wrote markdown report to ${outputPath}`);
