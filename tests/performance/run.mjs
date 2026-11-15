// CLI chạy một kịch bản với một đích.
//
//   node tests/performance/run.mjs --scenario rps10 --target sg
//   node tests/performance/run.mjs --scenario baseline --base-url http://127.0.0.1:18080
//   node tests/performance/run.mjs --list
//
// Tuỳ chọn: --scenario, --target (direct|sg|tokyo|entry), --base-url, --out <file.json>, --raw (ghi mọi mẫu),
//           --dry-run (chỉ in cấu hình, không gửi request).
// Kết quả mặc định ghi vào tests/performance/results/<scenario>-<target>-<thời điểm>.json
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run, peakRate, totalDuration } from './lib/engine.mjs';
import { buildRequest, redact, safetyCheck } from './lib/targets.mjs';
import { getScenario, SCENARIOS } from './scenarios.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const sleep = ms => new Promise(r => setTimeout(r, ms));

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2); const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true; else { out[key] = next; i += 1; }
  }
  return out;
}

export function describe(scenario) {
  return scenario.mode === 'vus'
    ? { mode: 'vus', vus: scenario.vus, durationS: scenario.durationS, peak: null }
    : { mode: 'arrival', durationS: totalDuration(scenario.stages), peak: peakRate(scenario.stages, scenario.startRate) };
}

export async function runScenario({ scenarioName, target, baseUrl, out, raw = false, dryRun = false, quiet = false, overrides = {} }) {
  const scenario = { ...getScenario(scenarioName), ...overrides };
  const req = buildRequest({ target, baseUrl, scenario });
  const info = describe(scenario);
  const peak = info.peak ?? 0;
  const log = quiet ? () => {} : (...a) => console.error(...a);

  const problems = safetyCheck({ req, scenario, peak, target });
  if (problems.length) { for (const p of problems) console.error(`CHẶN: ${p}`); process.exitCode = 2; return null; }

  log(`Kịch bản: ${scenario.name} — ${scenario.description}`);
  log(`Đích: ${req.label} ${req.method} ${req.url} (API key: ${req.gateway ? 'có, đã ẩn' : 'không dùng'})`);
  log(`Kiểu: ${info.mode}, thời lượng ~${info.durationS}s${info.peak != null ? `, đỉnh ${info.peak} RPS` : `, ${scenario.vus} VU`}`);
  if (!req.local) log('Nhắc: theo dõi CloudWatch (Lambda Throttles, ConcurrentExecutions, API GW 5XXError) trong lúc chạy. Ctrl+C để dừng.');
  if ((scenario.highLoad || peak > 100) && !req.local) {
    log('CẢNH BÁO TẢI CAO: Lambda của dự án có quota 10 concurrent executions/Region; tải này gần như chắc chắn bị throttle (429) và tốn chi phí. Bắt đầu sau 10 giây...');
    if (!dryRun) await sleep(10_000);
  }
  if (dryRun) { log('--dry-run: không gửi request.'); return { dryRun: true, request: redact(req), scenario }; }

  let lastPrint = 0;
  const outcome = await run({
    ...scenario, url: req.url, method: req.method, headers: req.headers, body: req.body,
    timeoutMs: scenario.timeoutMs ?? Number(process.env.PERF_TIMEOUT_MS ?? 10_000),
    onTick: ({ elapsedS, done, inflight, dropped }) => {
      if (quiet || elapsedS - lastPrint < 5) return; lastPrint = elapsedS;
      log(`  t=${elapsedS.toFixed(0)}s xong=${done} đang bay=${inflight} bỏ=${dropped}`);
    },
  });

  const report = {
    tool: 'tests/performance/run.mjs', percentileMethod: 'nearest-rank trên toàn bộ mẫu thô',
    startedAt: new Date(Date.now() - (outcome.summary.elapsedS ?? 0) * 1000).toISOString(),
    node: process.version, scenario: { ...scenario }, target: target ?? 'custom', request: redact(req),
    aborted: outcome.aborted, summary: outcome.summary, timeline: outcome.timeline,
    ...(raw ? { samples: outcome.results.map(({ doneAt, ...r }) => r) } : {}),
  };
  const file = out ?? join(HERE, 'results', `${scenario.name}-${target ?? 'custom'}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(report, null, 2));
  const s = outcome.summary;
  log(`Xong: ${s.total} request, ${s.achievedRps} RPS đạt được, lỗi ${(s.errorRate * 100).toFixed(2)}%, ` +
    `p50=${s.latencyMs.p50} p95=${s.latencyMs.p95} p99=${s.latencyMs.p99} ms` + (outcome.aborted ? ` — ABORT: ${outcome.aborted.reason}` : ''));
  log(`Kết quả: ${file}`);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  if (args.list || !args.scenario) {
    for (const name of Object.keys(SCENARIOS)) console.log(`${name.padEnd(17)} ${getScenario(name).description}`);
    if (!args.list) console.log('\nDùng: node tests/performance/run.mjs --scenario <tên> (--target direct|sg|tokyo|entry | --base-url URL)');
  } else {
    try {
      await runScenario({ scenarioName: args.scenario, target: args.target, baseUrl: typeof args['base-url'] === 'string' ? args['base-url'] : undefined,
        out: typeof args.out === 'string' ? args.out : undefined, raw: Boolean(args.raw), dryRun: Boolean(args['dry-run']) });
    } catch (err) { console.error(`Lỗi: ${err.message}`); process.exitCode = 1; }
  }
}
