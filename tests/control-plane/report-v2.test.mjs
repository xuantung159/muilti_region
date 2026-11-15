// Hợp đồng /api/report v2 (docs/performance/LATENCY_ANALYSIS.md mục 5.2). Trường cũ đã có test ở report.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.CONTROL_TABLE = 'control';
process.env.TELEMETRY_TABLE = 'telemetry';
const { db } = await import('../../src/shared/lib.mjs');
const { handler } = await import('../../src/dashboard/index.mjs');
const { buildReport, latencyStats, percentileSorted } = await import('../../src/dashboard/report.mjs');
const { ERROR_CLASSES } = await import('../../src/shared/errors.mjs');

const NOW = Date.parse('2026-11-10T12:00:30Z');
const at = (minAgo) => new Date(NOW - minAgo * 60_000).toISOString();
const rec = (o) => ({ timestamp: at(1), status: 200, latencyMs: 100, region: 'ap-southeast-1', keyId: 'aaaaaaaaaaaa',
  apiId: 'a1', method: 'GET', path: '/todos/1', country: 'VN', ...o });

const assertFiniteDeep = (value, path = '$') => {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `${path}=${value}`);
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) assertFiniteDeep(v, `${path}.${k}`);
};

test('percentile nearest-rank: rỗng null, 1 mẫu, mẫu nhỏ (p95 = max khi n < 20)', () => {
  assert.equal(percentileSorted([], 95), null);
  assert.deepEqual(latencyStats([]), { samples: 0, avgMs: null, p50Ms: null, p90Ms: null, p95Ms: null, p99Ms: null, maxMs: null });
  assert.deepEqual(latencyStats([42]), { samples: 1, avgMs: 42, p50Ms: 42, p90Ms: 42, p95Ms: 42, p99Ms: 42, maxMs: 42 });
  const ten = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  const s = latencyStats([...ten].reverse());
  assert.deepEqual([s.p50Ms, s.p90Ms, s.p95Ms, s.p99Ms, s.maxMs, s.avgMs], [50, 90, 100, 100, 100, 55]);
  const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.deepEqual([percentileSorted(hundred, 95), percentileSorted(hundred, 99), percentileSorted(hundred, 50)], [95, 99, 50]);
  assert.equal(latencyStats([10.4, 10.6]).avgMs, 11); // mili giây số nguyên (Math.round)
});

test('totals: p95 tính từ mẫu gộp, khác max p95 từng Region; avg gộp', () => {
  // SG: 19 × 100 ms + 1 × 1000 ms → p95 SG = phần tử thứ 19 = 100. Tokyo: 2 × 900 ms → p95 = 900.
  const items = [
    ...Array.from({ length: 19 }, () => rec({ latencyMs: 100 })),
    rec({ latencyMs: 1000 }),
    rec({ latencyMs: 900, region: 'ap-northeast-1' }),
    rec({ latencyMs: 900, region: 'ap-northeast-1' }),
  ];
  const r = buildReport(items, '1h', NOW);
  const [sg, tyo] = r.regions;
  assert.equal(sg.stats.latency.p95Ms, 100);
  assert.equal(tyo.stats.latency.p95Ms, 900);
  // Gộp 22 mẫu (19×100, 900, 900, 1000): rank ceil(0.95·22) = 21 → 900. Max p95 Region cũng là 900 ở đây,
  // nên kiểm thêm p90: gộp rank 20 → 900, trong khi max(p90 SG = 100, p90 Tokyo = 900) = 900; và p50 gộp = 100.
  assert.equal(r.totals.latency.samples, 22);
  assert.equal(r.totals.latency.p95Ms, 900);
  assert.equal(r.totals.latency.p99Ms, 1000);
  assert.equal(r.totals.latency.maxMs, 1000);
  assert.equal(r.totals.latency.avgMs, Math.round((19 * 100 + 1000 + 1800) / 22));
  assert.equal(r.totals.requests, sg.requests + tyo.requests);
  assert.equal(sg.latencyP95Ms, 100); // trường cũ giữ nguyên
  assertFiniteDeep(r);
});

test('totals.p95 khác max(p95 Region) khi một Region ít mẫu', () => {
  // SG: 40 × 100 ms; Tokyo: 1 × 2000 ms. max p95 Region = 2000, p95 gộp (41 mẫu, rank 39) = 100.
  const items = [...Array.from({ length: 40 }, () => rec({ latencyMs: 100 })), rec({ latencyMs: 2000, region: 'ap-northeast-1' })];
  const r = buildReport(items, '1h', NOW);
  assert.equal(Math.max(...r.regions.map((g) => g.stats.latency.p95Ms)), 2000);
  assert.equal(r.totals.latency.p95Ms, 100);
  assert.equal(r.totals.latency.maxMs, 2000);
});

test('latencySuccess chỉ gồm status < 400; latency gồm mọi request; tỷ lệ mẫu số là requests', () => {
  const items = [rec({ latencyMs: 50 }), rec({ latencyMs: 60 }), rec({ status: 504, errorType: 'UPSTREAM_TIMEOUT', latencyMs: 5000 }), rec({ status: 404, errorType: 'API_NOT_FOUND', latencyMs: 3 })];
  const { totals } = buildReport(items, '1h', NOW);
  assert.equal(totals.latency.samples, 4);
  assert.equal(totals.latency.maxMs, 5000);
  assert.deepEqual([totals.latencySuccess.samples, totals.latencySuccess.maxMs, totals.latencySuccess.avgMs], [2, 60, 55]);
  assert.deepEqual([totals.timeout, totals.errorsByClass.timeout, totals.errorsByClass.client_4xx], [1, 1, 1]);
  assert.deepEqual([totals.successRatePct, totals.errorRatePct, totals.error4xxRatePct, totals.error5xxRatePct, totals.timeoutRatePct, totals.upstreamErrorRatePct, totals.gatewayErrorRatePct],
    [50, 50, 25, 25, 25, 25, 0]);
});

test('báo cáo rỗng: tỷ lệ và latency null, số đếm 0, trường cũ 0', () => {
  const r = buildReport([], '24h', NOW);
  assert.equal(r.totals.requests, 0);
  for (const k of ['successRatePct', 'errorRatePct', 'error4xxRatePct', 'error5xxRatePct', 'gatewayErrorRatePct', 'upstreamErrorRatePct', 'timeoutRatePct']) assert.equal(r.totals[k], null, k);
  assert.equal(r.totals.latency.p95Ms, null);
  assert.equal(r.totals.latencySuccess.avgMs, null);
  assert.deepEqual(r.totals.errorsByClass, Object.fromEntries(ERROR_CLASSES.map((c) => [c, 0])));
  assert.deepEqual(r.regions.map((g) => [g.latencyAvgMs, g.latencyP95Ms, g.stats.requests, g.stats.latency.samples]), [[0, 0, 0, 0], [0, 0, 0, 0]]);
  assert.deepEqual([r.errorsByKey, r.errorTypes, r.endpoints, r.routes], [[], [], [], []]);
});

test('series: ô rỗng hasData=false, latency null, trường cũ 0; ô có dữ liệu đủ trường; chỉ ô cuối partial', () => {
  const items = [rec({ timestamp: at(1), latencyMs: 80 }), rec({ timestamp: at(1), status: 502, errorType: 'UPSTREAM_UNREACHABLE', latencyMs: 20 })];
  const r = buildReport(items, '1h', NOW);
  const empty = r.series[0].regions['ap-southeast-1'];
  assert.deepEqual([empty.hasData, empty.latency, empty.requests, empty.latencyAvgMs, empty.latencyP95Ms, empty.timeout], [false, null, 0, 0, 0, 0]);
  const cell = r.series.find((p) => p.regions['ap-southeast-1'].requests > 0).regions['ap-southeast-1'];
  assert.deepEqual([cell.hasData, cell.requests, cell.error5xx, cell.upstreamErrors, cell.gatewayErrors, cell.timeout, cell.errorsByClass.connection_error], [true, 2, 1, 1, 0, 0, 1]);
  assert.deepEqual(cell.latency, { avgMs: 50, p50Ms: 20, p95Ms: 80, p99Ms: 80 });
  assert.equal(r.series.filter((p) => p.partial).length, 1);
  assert.equal(r.series.at(-1).partial, true);
  assert.deepEqual(r.window, { startMs: r.series[0].t, endMs: NOW, bucketMs: 60_000, buckets: 60 });
  assert.equal(r.schemaVersion, 2);
  assert.deepEqual(r.filters, { range: '1h', keyId: null, region: 'all' });
  // Tổng theo series bằng regions (không mất, không trùng).
  assert.equal(r.series.reduce((s, p) => s + p.regions['ap-southeast-1'].requests, 0), r.regions[0].requests);
});

test('cửa sổ 7d: 84 ô × 2 giờ, startMs căn theo ô (độ dài thực từ 166 tới 168 giờ)', () => {
  const r = buildReport([], '7d', NOW);
  assert.equal(r.window.buckets, 84);
  assert.equal(r.window.bucketMs, 2 * 3_600_000);
  const hours = (r.window.endMs - r.window.startMs) / 3_600_000;
  assert.ok(hours > 166 && hours <= 168, String(hours));
});

test('bộ lọc region: áp cho totals/errorsByKey/errorTypes/endpoints/routes, không áp cho regions[] và series', () => {
  const items = [rec({}), rec({ status: 500 }), rec({ region: 'ap-northeast-1', country: 'JP', status: 404, errorType: 'API_NOT_FOUND' })];
  const all = buildReport(items, '1h', NOW);
  const tyo = buildReport(items, '1h', NOW, null, { region: 'ap-northeast-1' });
  assert.equal(all.totals.requests, 3);
  assert.equal(tyo.totals.requests, 1);
  assert.deepEqual(tyo.regions.map((g) => g.requests), [2, 1]);
  assert.equal(tyo.series.reduce((s, p) => s + p.regions['ap-southeast-1'].requests, 0), 2);
  assert.deepEqual(tyo.routes.map((x) => x.country), ['JP']);
  assert.ok(tyo.endpoints.length && tyo.endpoints.every((e) => e.region === 'ap-northeast-1'));
  assert.deepEqual(tyo.errorTypes.map((e) => [e.errorClass, e.errorType, e.status, e.region, e.count]), [['client_4xx', 'API_NOT_FOUND', 404, 'ap-northeast-1', 1]]);
  assert.deepEqual(tyo.errorsByKey.map((k) => k.requests), [1]);
  assert.equal(tyo.filters.region, 'ap-northeast-1');
  // Không đếm trùng: tổng hai Region = tổng 'all'.
  const sg = buildReport(items, '1h', NOW, null, { region: 'ap-southeast-1' });
  assert.equal(sg.totals.requests + tyo.totals.requests, all.totals.requests);
  // keyId + region cùng áp.
  assert.equal(buildReport(items, '1h', NOW, 'bbbbbbbbbbbb', { region: 'ap-southeast-1' }).totals.requests, 0);
});

test('item cũ không có trường đo: breakdown samples 0, mọi giá trị null; item v2 góp mẫu riêng từng nhóm', () => {
  const legacy = buildReport([rec({}), rec({ status: 502, errorType: 'UPSTREAM_UNREACHABLE' })], '1h', NOW);
  assert.deepEqual(legacy.totals.breakdown, {
    samples: 0, gatewayAvgMs: null, gatewayP95Ms: null, upstreamSamples: 0, upstreamAvgMs: null, upstreamP95Ms: null,
    connectSamples: 0, upstreamConnectAvgMs: null, upstreamConnectP95Ms: null, ttfbSamples: 0, upstreamTtfbAvgMs: null, upstreamTtfbP95Ms: null,
    reusedConnectionPct: null, coldStarts: 0,
  });
  assert.equal(legacy.totals.errorsByClass.connection_error, 1); // item cũ vẫn được phân loại
  const mixed = buildReport([
    rec({}),
    rec({ schemaVersion: 2, gatewayMs: 10, upstreamMs: 90, upstreamTtfbMs: 80, upstreamConnectMs: 40, upstreamReused: false, coldStart: true }),
    rec({ schemaVersion: 2, gatewayMs: 20, upstreamMs: 110, upstreamTtfbMs: 100, upstreamReused: true, coldStart: false }),
    rec({ schemaVersion: 2, status: 404, errorType: 'API_NOT_FOUND', errorClass: 'client_4xx', gatewayMs: 5, coldStart: false }),
  ], '1h', NOW);
  const b = mixed.totals.breakdown;
  assert.deepEqual([b.samples, b.upstreamSamples, b.connectSamples, b.ttfbSamples, b.coldStarts], [3, 2, 1, 2, 1]);
  assert.deepEqual([b.gatewayAvgMs, b.gatewayP95Ms, b.upstreamAvgMs, b.upstreamP95Ms, b.upstreamConnectAvgMs, b.upstreamTtfbP95Ms], [12, 20, 100, 110, 40, 100]);
  assert.equal(b.reusedConnectionPct, 50);
});

test('bất biến 4xx/5xx trên totals, regions[].stats, series và errorsByKey; không NaN/Infinity', () => {
  const types = [[200], [301], [404, 'API_NOT_FOUND'], [403, 'API_DISABLED'], [404], [429], [500, 'GATEWAY_INTERNAL'], [504, 'UPSTREAM_TIMEOUT'],
    [502, 'UPSTREAM_UNREACHABLE'], [502, 'UPSTREAM_TOO_LARGE'], [503, 'UPSTREAM_5XX'], [500, 'WEIRD'], [500, 'API_NOT_FOUND', 'client_4xx']];
  const items = [];
  types.forEach(([status, errorType, errorClass], i) => {
    for (const region of ['ap-southeast-1', 'ap-northeast-1']) {
      items.push(rec({ status, errorType, errorClass, region, keyId: i % 2 ? 'aaaaaaaaaaaa' : 'bbbbbbbbbbbb', timestamp: at(i * 3), latencyMs: 10 * (i + 1) }));
    }
  });
  const r = buildReport(items, '1h', NOW);
  const check = (s) => {
    assert.equal(s.error4xx, s.errorsByClass.client_4xx + s.errorsByClass.upstream_4xx);
    assert.equal(s.error5xx, s.errorsByClass.gateway + s.errorsByClass.upstream_5xx + s.errorsByClass.timeout + s.errorsByClass.connection_error);
  };
  check(r.totals);
  r.regions.forEach((g) => { check(g.stats); assert.deepEqual([g.error4xx, g.error5xx, g.success], [g.stats.error4xx, g.stats.error5xx, g.stats.success]); });
  r.series.forEach((p) => Object.values(p.regions).forEach(check));
  r.errorsByKey.forEach(check);
  assertFiniteDeep(r);
  assert.ok(!JSON.stringify(r).includes('NaN'));
});

test('errorsByKey: tên/trạng thái từ danh sách key, null nếu key đã xóa; sắp theo số lỗi rồi requests rồi keyId', () => {
  const items = [
    rec({ keyId: 'cccccccccccc' }), rec({ keyId: 'cccccccccccc' }),
    rec({ keyId: 'aaaaaaaaaaaa' }), rec({ keyId: 'aaaaaaaaaaaa' }),
    rec({ keyId: 'bbbbbbbbbbbb', status: 500 }),
  ];
  const keys = [{ keyId: 'aaaaaaaaaaaa', name: 'web', status: 'active' }, { keyId: 'bbbbbbbbbbbb', name: 'batch', status: 'revoked' }];
  const r = buildReport(items, '1h', NOW, null, { keys });
  assert.deepEqual(r.errorsByKey.map((k) => [k.keyId, k.name, k.status, k.requests, k.error5xx, k.errorRatePct]), [
    ['bbbbbbbbbbbb', 'batch', 'revoked', 1, 1, 100],
    ['aaaaaaaaaaaa', 'web', 'active', 2, 0, 0],
    ['cccccccccccc', null, null, 2, 0, 0],
  ]);
});

test('errorTypes nhóm theo (errorClass, errorType, status, region), sắp count rồi lastSeen; endpoint có trường mới', () => {
  const items = [
    rec({ status: 404, timestamp: at(5) }), rec({ status: 404, timestamp: at(2) }),
    rec({ status: 502, errorType: 'UPSTREAM_UNREACHABLE', timestamp: at(1) }),
    rec({ status: 504, errorType: 'UPSTREAM_TIMEOUT', timestamp: at(3) }),
  ];
  const r = buildReport(items, '1h', NOW);
  assert.deepEqual(r.errorTypes.map((e) => [e.errorClass, e.errorType, e.status, e.count]), [
    ['upstream_4xx', null, 404, 2], ['connection_error', 'UPSTREAM_UNREACHABLE', 502, 1], ['timeout', 'UPSTREAM_TIMEOUT', 504, 1],
  ]);
  assert.equal(r.errorTypes[0].lastSeen, Date.parse(at(2)));
  const [ep] = r.endpoints;
  assert.deepEqual([ep.error4xxRatePct, ep.timeoutRatePct, ep.errorsByClass.timeout, ep.latencyP50Ms, ep.latencyP99Ms], [50, 25, 1, 100, 100]);
});

test('/api/report: tham số region được áp, giá trị lạ trả 400; ProjectionExpression có trường mới', async () => {
  const queried = [];
  db.send = async (command) => {
    const input = command.input;
    if (command.constructor.name === 'GetCommand') return { Item: { tenantId: 'tenant-a', expiresAt: Date.now() / 1000 + 60 } };
    if (input.TableName === 'control') return { Items: [{ keyId: 'aaaaaaaaaaaa', name: 'project_test', status: 'active', keyHash: 'secret-hash' }] };
    queried.push(input);
    const ts = new Date().toISOString();
    return { Items: [rec({ timestamp: ts }), rec({ timestamp: ts, region: 'ap-northeast-1' })] };
  };
  const call = (qs) => handler({ httpMethod: 'GET', path: '/api/report', queryStringParameters: qs, headers: { Authorization: `Bearer ${'f'.repeat(64)}` } });
  const ok = await call({ range: '1h', region: 'ap-southeast-1' });
  assert.equal(ok.statusCode, 200);
  const body = JSON.parse(ok.body);
  assert.deepEqual([body.schemaVersion, body.filters.region, body.totals.requests, body.regions.map((g) => g.requests).join()], [2, 'ap-southeast-1', 1, '1,1']);
  assert.deepEqual(body.errorsByKey.map((k) => k.name), ['project_test']);
  assert.ok(!ok.body.includes('secret-hash'));
  const bad = await call({ range: '1h', region: 'us-east-1' });
  assert.equal(bad.statusCode, 400);
  assert.equal(JSON.parse(bad.body).error, 'region phải là all, ap-southeast-1 hoặc ap-northeast-1');
  assert.equal(JSON.parse((await call({ range: '1h' })).body).filters.region, 'all');
  assert.equal(JSON.parse((await call({ range: '1h', region: 'all' })).body).totals.requests, 2);
  const projection = queried[0].ProjectionExpression;
  for (const f of ['errorClass', 'errorCause', 'gatewayMs', 'upstreamMs', 'upstreamConnectMs', 'upstreamTtfbMs', 'upstreamStatus', 'upstreamReused', 'coldStart']) assert.ok(projection.includes(f), f);
});
