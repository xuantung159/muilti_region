// So sánh đường đi với CÙNG workload và payload: A direct, B Singapore, C Tokyo, D entry (Route 53).
// Chạy tuần tự từng đích (không song song, để các đích không tranh băng thông của máy test),
// nghỉ PERF_COOLDOWN_S giây (mặc định 30) giữa hai đích. Đích nào thiếu biến môi trường thì bỏ qua.
//
//   node tests/performance/compare.mjs --scenario baseline
//   node tests/performance/compare.mjs --scenario rps10 --targets direct,sg,tokyo,entry
//
// In bảng Markdown ra stdout và ghi tests/performance/results/compare-<scenario>-<thời điểm>.json
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGETS } from './lib/targets.mjs';
import { parseArgs, runScenario } from './run.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
const scenarioName = typeof args.scenario === 'string' ? args.scenario : 'baseline';
const targets = (typeof args.targets === 'string' ? args.targets : 'direct,sg,tokyo,entry').split(',').map(s => s.trim()).filter(Boolean);
const cooldown = Number(process.env.PERF_COOLDOWN_S ?? 30);

if (scenarioName === 'region-failure' || scenarioName === 'rps500') {
  console.error(`Kịch bản ${scenarioName} không dùng để so sánh đường đi; chạy riêng bằng run.mjs.`);
  process.exit(2);
}

const rows = [];
for (const [i, target] of targets.entries()) {
  const t = TARGETS[target];
  if (!t) { console.error(`Bỏ qua target lạ: ${target}`); continue; }
  if (!process.env[t.env]) { console.error(`Bỏ qua ${target}: chưa đặt ${t.env}`); rows.push({ target, label: t.label, skipped: true }); continue; }
  if (i > 0 && rows.some(r => !r.skipped) && !args['dry-run']) await new Promise(r => setTimeout(r, cooldown * 1000));
  const report = await runScenario({ scenarioName, target, dryRun: Boolean(args['dry-run']) });
  if (!report || report.dryRun) { rows.push({ target, label: t.label, skipped: true }); continue; }
  rows.push({ target, label: t.label, summary: report.summary, aborted: report.aborted });
}

const fmt = v => (v == null ? '—' : String(v));
const lines = [
  `| Đường đi | Request | RPS đạt | Lỗi % | avg | p50 | p90 | p95 | p99 | 429 | Ghi chú |`,
  `|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|`,
  ...rows.map(r => r.skipped
    ? `| ${r.label} | Chưa đo | | | | | | | | | thiếu cấu hình |`
    : `| ${r.label} | ${r.summary.total} | ${fmt(r.summary.achievedRps)} | ${(r.summary.errorRate * 100).toFixed(2)} | ${fmt(r.summary.latencyMs.avg)} | ${fmt(r.summary.latencyMs.p50)} | ${fmt(r.summary.latencyMs.p90)} | ${fmt(r.summary.latencyMs.p95)} | ${fmt(r.summary.latencyMs.p99)} | ${r.summary.throttled429} | ${r.aborted ? `ABORT: ${r.aborted.reason}` : ''} |`),
];
console.log(`\nKịch bản: ${scenarioName} (đơn vị độ trễ: ms, đo phía client)\n`);
console.log(lines.join('\n'));
const file = join(HERE, 'results', `compare-${scenarioName}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
await mkdir(dirname(file), { recursive: true });
await writeFile(file, JSON.stringify({ scenario: scenarioName, rows }, null, 2));
console.error(`Kết quả: ${file}`);
