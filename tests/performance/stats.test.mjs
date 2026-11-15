// node --test tests/performance/stats.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { percentile, latencySummary, classify, summarize } from './lib/stats.mjs';
import { expectedArrivals, peakRate, totalDuration, run } from './lib/engine.mjs';
import { buildRequest, redact, safetyCheck } from './lib/targets.mjs';

test('percentile nearest-rank: ví dụ kinh điển 5 phần tử', () => {
  const xs = [15, 20, 35, 40, 50];
  assert.equal(percentile(xs, 5), 15);
  assert.equal(percentile(xs, 30), 20);
  assert.equal(percentile(xs, 40), 20);
  assert.equal(percentile(xs, 50), 35);
  assert.equal(percentile(xs, 100), 50);
  assert.equal(percentile(xs, 0), 15);
});

test('percentile 1..100: Pp = p', () => {
  const xs = Array.from({ length: 100 }, (_, i) => i + 1);
  for (const p of [1, 50, 90, 95, 99, 100]) assert.equal(percentile(xs, p), p);
  assert.equal(percentile(xs, 99.5), 100);
});

test('percentile: rỗng → null, một phần tử, p ngoài khoảng ném lỗi', () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([7], 99), 7);
  assert.throws(() => percentile([1], 101), RangeError);
  assert.throws(() => percentile([1], -1), RangeError);
});

test('latencySummary không phụ thuộc thứ tự và bỏ giá trị không hữu hạn', () => {
  const s = latencySummary([5, 1, 4, 2, 3, NaN, undefined]);
  assert.deepEqual(s, { count: 5, min: 1, avg: 3, p50: 3, p90: 5, p95: 5, p99: 5, max: 5 });
  assert.equal(latencySummary([]).p95, null);
});

test('classify và summarize đếm đúng nhóm, tỉ lệ lỗi và throughput', () => {
  const rs = [
    { status: 200, latencyMs: 10, ttfbMs: 5, region: 'ap-southeast-1' },
    { status: 204, latencyMs: 20, ttfbMs: 5, region: 'ap-southeast-1' },
    { status: 302, latencyMs: 30, ttfbMs: 5 },
    { status: 429, latencyMs: 2, ttfbMs: 1, region: 'ap-northeast-1' },
    { status: 504, latencyMs: 5000, ttfbMs: 5000 },
    { error: 'timeout' },
    { error: 'connection', code: 'ECONNREFUSED' },
  ];
  assert.equal(classify(rs[3]), '4xx');
  assert.equal(classify(rs[5]), 'timeout');
  const s = summarize(rs, { startedAt: 0, endedAt: 2000 });
  assert.deepEqual(s.counts, { '2xx': 2, '3xx': 1, '4xx': 1, '5xx': 1, timeout: 1, connection: 1, other: 0 });
  assert.equal(s.total, 7);
  assert.equal(s.errorRate, Math.round((4 / 7) * 10000) / 10000);
  assert.equal(s.achievedRps, 3.5);
  assert.equal(s.throttled429, 1);
  assert.deepEqual(s.regions, { 'ap-southeast-1': 2, 'ap-northeast-1': 1 });
  assert.equal(s.latencyMs.count, 5); // timeout/lỗi kết nối không có độ trễ
  assert.equal(s.successLatencyMs.count, 3);
  assert.equal(s.successLatencyMs.max, 30);
});

test('expectedArrivals: tích phân của ramp tuyến tính', () => {
  const stages = [{ durationS: 10, target: 10 }, { durationS: 10, target: 10 }];
  assert.equal(expectedArrivals(stages, 10, 0), 50);
  assert.equal(expectedArrivals(stages, 20, 0), 150);
  assert.equal(expectedArrivals(stages, 99, 0), 150);
  assert.equal(expectedArrivals(stages, 5, 0), 12.5);
  assert.equal(totalDuration(stages), 20);
  assert.equal(peakRate(stages, 1), 10);
});

test('engine (request giả, không mạng): đếm và abort', async () => {
  let n = 0;
  const fake = async () => ({ t: 0, status: (n++ % 2) ? 500 : 200, latencyMs: 1, ttfbMs: 1 });
  const ok = await run({ mode: 'vus', vus: 2, durationS: 0.2, thinkMs: 10, request: async () => ({ t: 0, status: 200, latencyMs: 1, ttfbMs: 1 }) });
  assert.ok(ok.summary.total > 0); assert.equal(ok.summary.errorRate, 0); assert.equal(ok.aborted, null);
  const bad = await run({ mode: 'arrival', startRate: 200, stages: [{ durationS: 5, target: 200 }], request: fake,
    abort: { errorRate: 0.1, minSamples: 20, windowS: 5 } });
  assert.ok(bad.aborted, 'phải abort khi lỗi 50%');
  assert.ok(bad.summary.total < 1000);
});

test('targets: API key đi vào header nhưng bị ẩn khi ghi; cổng an toàn chặn host lạ và tải cao', () => {
  const env = { BASE_URL_SG: 'https://example.invalid/demo', API_ID: 'abc', API_KEY: 'secret-key', PERF_PATH: '/orders' };
  const req = buildRequest({ target: 'sg', scenario: { query: { delay: '10' } }, env });
  assert.equal(req.url, 'https://example.invalid/demo/proxy/abc/orders?delay=10');
  assert.equal(req.headers['x-api-key'], 'secret-key');
  assert.ok(!JSON.stringify(redact(req)).includes('secret-key'));
  assert.equal(safetyCheck({ req, scenario: { name: 'rps10' }, peak: 10, target: 'sg', env }).length, 1);
  assert.equal(safetyCheck({ req, scenario: { name: 'rps10' }, peak: 10, target: 'sg', env: { PERF_CONFIRM_OWNED: '1' } }).length, 0);
  assert.equal(safetyCheck({ req, scenario: { name: 'rps500', highLoad: true }, peak: 500, target: 'sg', env: { PERF_CONFIRM_OWNED: '1' } }).length, 1);
  const local = buildRequest({ baseUrl: 'http://127.0.0.1:1', scenario: {}, env: {} });
  assert.equal(local.local, true);
  assert.equal(local.url, 'http://127.0.0.1:1/orders');
  assert.equal(safetyCheck({ req: local, scenario: { name: 'rps500', highLoad: true }, peak: 500, env: {} }).length, 1);
});
