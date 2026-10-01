const target = process.env.LOAD_TEST_URL || "http://127.0.0.1:4173/api/health";
const total = Math.max(1, Number(process.env.LOAD_TEST_REQUESTS || 200));
const concurrency = Math.max(1, Number(process.env.LOAD_TEST_CONCURRENCY || 25));
const latencies = [];
const statuses = new Map();
let cursor = 0;

async function worker() {
  while (true) {
    const current = cursor++;
    if (current >= total) return;
    const started = performance.now();
    try {
      const response = await fetch(target, { headers: { "User-Agent": "legal-advisor-load-check/1.0" } });
      await response.arrayBuffer();
      statuses.set(response.status, (statuses.get(response.status) || 0) + 1);
    } catch {
      statuses.set("network-error", (statuses.get("network-error") || 0) + 1);
    } finally {
      latencies.push(performance.now() - started);
    }
  }
}

const started = performance.now();
await Promise.all(Array.from({ length: concurrency }, worker));
const elapsed = performance.now() - started;
latencies.sort((a, b) => a - b);
const percentile = (p) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] || 0;
const result = {
  target, total, concurrency,
  statuses: Object.fromEntries(statuses),
  requestsPerSecond: Number((total / (elapsed / 1000)).toFixed(2)),
  latencyMs: { p50: Number(percentile(0.5).toFixed(1)), p95: Number(percentile(0.95).toFixed(1)), p99: Number(percentile(0.99).toFixed(1)), max: Number(Math.max(...latencies).toFixed(1)) },
};
console.log(JSON.stringify(result, null, 2));
if ([...statuses].some(([status]) => status === "network-error" || Number(status) >= 500)) process.exitCode = 1;
