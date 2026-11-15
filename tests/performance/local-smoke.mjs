// Smoke test HOÀN TOÀN LOCAL: không gọi AWS, không cần biến môi trường.
// Khởi động mock-upstream.mjs ở tiến trình con (cổng ngẫu nhiên trên 127.0.0.1), chạy các kịch bản
// rút gọn bằng chính run.mjs, kiểm tra vài bất biến rồi in bảng kết quả.
//
//   node tests/performance/local-smoke.mjs
//
// Số đo ở đây chỉ chứng minh script và phần thống kê hoạt động; KHÔNG nói gì về hiệu năng AWS.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { runScenario } from './run.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
for (const k of ['BASE_URL_DIRECT', 'BASE_URL_SG', 'BASE_URL_TOKYO', 'BASE_URL_ENTRY', 'API_KEY', 'API_ID', 'PERF_PATH', 'PERF_BODY', 'PERF_METHOD', 'PERF_DURATION_SCALE'])
  delete process.env[k];

const child = spawn(process.execPath, [join(HERE, 'mock-upstream.mjs')], { env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
const [line] = await once(createInterface({ input: child.stdout }), 'line');
const base = JSON.parse(line).listening;
console.error(`Mock upstream: ${base}`);

const cases = [
  { name: 'baseline', scenario: 'baseline', overrides: { durationS: 5, thinkMs: 100 } },
  { name: 'ramp-50rps', scenario: 'rps50', overrides: { startRate: 1, stages: [{ durationS: 3, target: 50 }, { durationS: 5, target: 50 }] } },
  { name: 'concurrent-20vu', scenario: 'concurrent', overrides: { vus: 20, durationS: 5 } },
  { name: 'upstream-delay-50ms', scenario: 'rps10', overrides: { query: { delay: '50' }, stages: [{ durationS: 5, target: 10 }] } },
  { name: 'client-timeout', scenario: 'upstream-timeout', overrides: { query: { delay: '400' }, timeoutMs: 200, startRate: 5, stages: [{ durationS: 3, target: 5 }] } },
  { name: 'abort-on-5xx', scenario: 'rps10', overrides: { query: { status: '503' }, startRate: 20, stages: [{ durationS: 20, target: 20 }],
    abort: { errorRate: 0.1, p95Ms: 3000, windowS: 5, minSamples: 20 } } },
];

const outDir = join(HERE, 'results', `local-smoke-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const rows = []; const failures = [];
try {
  for (const c of cases) {
    const report = await runScenario({ scenarioName: c.scenario, baseUrl: base, overrides: { ...c.overrides, name: c.name }, out: join(outDir, `${c.name}.json`), quiet: true });
    const s = report.summary;
    rows.push({ case: c.name, s, aborted: report.aborted });
    console.error(`  ${c.name}: ${s.total} req, lỗi ${(s.errorRate * 100).toFixed(1)}%${report.aborted ? `, ABORT ${report.aborted.reason}` : ''}`);
  }
  const by = n => rows.find(r => r.case === n);
  const expect = (cond, msg) => { if (!cond) failures.push(msg); };
  expect(by('baseline').s.counts['2xx'] === by('baseline').s.total && by('baseline').s.total > 0, 'baseline phải 100% 2xx');
  expect(by('ramp-50rps').s.total >= 250 && by('ramp-50rps').s.total <= 360, `ramp-50rps kỳ vọng ~326 request, nhận ${by('ramp-50rps').s.total}`);
  expect(by('upstream-delay-50ms').s.latencyMs.p50 >= 50, 'độ trễ phải >= delay 50 ms của upstream');
  expect(by('client-timeout').s.counts.timeout === by('client-timeout').s.total, 'client-timeout: mọi request phải bị đếm là timeout');
  expect(by('abort-on-5xx').aborted && by('abort-on-5xx').s.counts['5xx'] > 0 && by('abort-on-5xx').s.total < 400, 'abort-on-5xx phải dừng sớm');
} finally {
  child.kill();
}

const f = v => (v == null ? '—' : String(v));
const table = [
  '| Ca (local mock) | Request | RPS đạt | 2xx | 5xx | timeout | conn err | avg | p50 | p90 | p95 | p99 | max | Abort |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|',
  ...rows.map(({ case: name, s, aborted }) => `| ${name} | ${s.total} | ${f(s.achievedRps)} | ${s.counts['2xx']} | ${s.counts['5xx']} | ${s.counts.timeout} | ${s.counts.connection} | ${f(s.latencyMs.avg)} | ${f(s.latencyMs.p50)} | ${f(s.latencyMs.p90)} | ${f(s.latencyMs.p95)} | ${f(s.latencyMs.p99)} | ${f(s.latencyMs.max)} | ${aborted ? `có (t=${aborted.atS.toFixed(1)}s): ${aborted.reason}` : 'không'} |`),
];
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'summary.md'), table.join('\n') + '\n');
console.log(`Node ${process.version}, ${process.platform}; mock upstream ${base}\n`);
console.log(table.join('\n'));
console.log(failures.length ? `\nFAIL:\n- ${failures.join('\n- ')}` : '\nPASS: mọi bất biến của smoke test đều đúng.');
console.error(`Kết quả chi tiết: ${outDir}`);
process.exitCode = failures.length ? 1 : 0;
