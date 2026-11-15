import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createService, handleRequest as handler, isUserResource } from '../../src/monitoring/index.mjs';

const NOW = Date.UTC(2026, 9, 23, 10, 0, 0);
const T0 = Date.UTC(2026, 9, 23, 9, 0, 0); // ô 09:00 và 09:01 nằm trong khoảng 1h (08:58-09:58)
const T1 = T0 + 60_000;

// Client giả: metrics = { [region]: { [id]: [[ts, value], ...] } }
const fakeClients = (metrics = {}, extra = {}) => (region) => ({
  async send(command) {
    const name = command.constructor.name;
    if (extra.fail) throw Object.assign(new Error('denied'), { name: 'AccessDeniedException' });
    if (name === 'GetMetricDataCommand') {
      return {
        MetricDataResults: command.input.MetricDataQueries.flatMap((q) => {
          const points = metrics[region]?.[q.Id];
          return points ? [{ Id: q.Id, Timestamps: points.map(([t]) => new Date(t)), Values: points.map(([, v]) => v) }] : [];
        }),
      };
    }
    if (name === 'ListMetricsCommand') return { Metrics: extra.listMetrics?.[region] ?? [] };
    if (name === 'DescribeAlarmHistoryCommand') return { AlarmHistoryItems: extra.alarmHistory?.[region] ?? [] };
    throw new Error(`unexpected ${name}`);
  },
});

const dim = (resource, method, apiName = 'mrapi-api-sg') => ({ Dimensions: [
  { Name: 'ApiName', Value: apiName }, { Name: 'Stage', Value: 'demo' },
  { Name: 'Resource', Value: resource }, { Name: 'Method', Value: method },
] });
// Thứ tự trong ListMetrics quyết định chỉ số i của id u_c{i}: chỉ đánh số các resource /proxy.
const SG_ROUTES = [dim('/health', 'GET'), dim('/proxy/{apiId}/{proxy+}', 'ANY'), dim('/api/{proxy+}', 'ANY'), dim('/monitoring/{proxy+}', 'GET')];

// Stage nhận 400 request (gồm health check, portal, monitoring), trong đó chỉ 150 request tới /proxy.
const sg = {
  a_count: [[T0, 300], [T1, 100]], a_e4: [[T0, 10], [T1, 5]], a_e5: [[T0, 1], [T1, 0]],
  u_c0: [[T0, 100], [T1, 50]], u_e40: [[T0, 2], [T1, 1]], u_e50: [[T0, 1], [T1, 0]],
  u_l0: [[T0, 40], [T1, 60]], u_p0: [[T0, 90], [T1, 100]], t_p950: [[T0, 95]],
  l_inv: [[T0, 220], [T1, 110]], l_err: [[T0, 1], [T1, 0]], l_dur: [[T0, 30], [T1, 30]],
  d_rep: [[T0, 800], [T1, 1000]],
};
// Metric S3 Replication của bucket Singapore nằm ở Region đích (Tokyo).
const S3_SG_TO_TYO = { s_rep: [[T0, 20]] };
const service = (metrics, extra) => createService({ clientFor: fakeClients(metrics, extra), now: () => NOW });

test('chỉ resource /proxy được tính là request người dùng', () => {
  assert.equal(isUserResource('/proxy/{apiId}/{proxy+}'), true);
  assert.equal(isUserResource('/proxy/{apiId}'), true);
  assert.equal(isUserResource('/health'), false);
  assert.equal(isUserResource('/api/{proxy+}'), false);
  assert.equal(isUserResource('/monitoring/{proxy+}'), false);
  assert.equal(isUserResource('/proxyfake'), false);
});

test('snapshot SG chỉ đếm request /proxy; Tokyo không có dữ liệu thì missing, không phải 0', async () => {
  const snap = await service({ 'ap-southeast-1': sg, 'ap-northeast-1': S3_SG_TO_TYO }, { listMetrics: { 'ap-southeast-1': SG_ROUTES } }).snapshot('1h');
  const [s, t] = snap.regions;
  assert.equal(snap.dataMode, 'live');
  assert.equal(s.requests.value, 150); // không phải 400 của cả stage
  assert.equal(s.errorRatePct.value, 2.67);
  assert.equal(s.successRatePct.value, 97.33);
  assert.equal(s.serverErrorRatePct.kind, 'value'); // chỉ 5xx, tách khỏi 4xx của client
  assert.ok(s.serverErrorRatePct.value <= s.errorRatePct.value);
  assert.equal(s.latencyAvgMs.value, 47); // trung bình có trọng số theo số request
  assert.equal(s.latencyP95Ms.value, 95);
  // Mục "API Gateway (toàn stage)" vẫn giữ số liệu cả stage để đối chiếu hạ tầng.
  assert.equal(s.apiGateway.requests.value, 400);
  assert.equal(s.apiGateway.error4xx.value, 15);
  assert.equal(s.lambda.invocations.value, 330);
  assert.equal(s.lambda.errors.value, 1);
  assert.equal(s.dynamodbReplicationLatencyMs.value, 900);
  assert.equal(s.dynamodbReplicationObservedAt, T1);
  assert.equal(s.s3ReplicationObservedAt, T0);
  assert.equal(t.dynamodbReplicationObservedAt, null);
  assert.equal(s.s3ReplicationLatencyS.value, 20);
  assert.deepEqual(s.healthCheck, { kind: 'missing', reason: 'unavailable' }); // fake không trả HealthCheckStatus
  assert.deepEqual(t.requests, { kind: 'missing', reason: 'unavailable' });
  assert.deepEqual(t.apiGateway.requests, { kind: 'missing', reason: 'unavailable' });
  assert.deepEqual(s.trafficSharePct, { kind: 'missing', reason: 'unavailable' }); // thiếu dữ liệu Tokyo thì không báo 100%
  assert.equal(snap.series.length, 2);
  assert.equal(snap.series[0].regions['ap-southeast-1'].requests, 100);
  assert.equal(snap.series[0].regions['ap-southeast-1'].success, 97);
  assert.equal(snap.series[0].regions['ap-southeast-1'].latencyP95Ms, 90);
  assert.equal(snap.series[0].regions['ap-northeast-1'].requests, 0);
});

test('hệ thống vừa có tài khoản đăng ký, chưa gọi API: request = 0 dù có health check và portal', async () => {
  // Chỉ có traffic hệ thống: Route 53 health check vào /health, đăng ký qua /api/*, dashboard gọi /monitoring/*.
  const listMetrics = {
    'ap-southeast-1': [dim('/health', 'GET'), dim('/api/{proxy+}', 'ANY'), dim('/monitoring/{proxy+}', 'GET')],
    'ap-northeast-1': [dim('/health', 'GET', 'mrapi-api-tyo')],
  };
  const metrics = {
    'ap-southeast-1': { a_count: [[T0, 64], [T1, 66]], l_inv: [[T0, 60], [T1, 60]] },
    'ap-northeast-1': { a_count: [[T0, 60], [T1, 60]], l_inv: [[T0, 60], [T1, 60]] },
  };
  const snap = await service(metrics, { listMetrics }).snapshot('1h');
  for (const r of snap.regions) {
    assert.deepEqual(r.requests, { kind: 'value', value: 0 });
    assert.deepEqual(r.errorRatePct, { kind: 'missing', reason: 'unavailable' }); // không có request thì không có tỷ lệ lỗi
    assert.deepEqual(r.serverErrorRatePct, { kind: 'missing', reason: 'unavailable' });
    assert.deepEqual(r.latencyAvgMs, { kind: 'missing', reason: 'unavailable' });
    assert.deepEqual(r.latencyP95Ms, { kind: 'missing', reason: 'unavailable' });
    assert.deepEqual(r.trafficSharePct, { kind: 'missing', reason: 'unavailable' });
  }
  assert.equal(snap.regions[0].apiGateway.requests.value, 130);
  assert.ok(snap.series.length > 0);
  assert.ok(snap.series.every((p) => p.regions['ap-southeast-1'].requests === 0 && p.regions['ap-northeast-1'].requests === 0));

  const endpoints = await service(metrics, { listMetrics }).endpoints('1h');
  assert.deepEqual(endpoints, []);
});

test('API Gateway toàn stage tách được phần Route 53 health check (/health) và /proxy của mọi doanh nghiệp', async () => {
  const listMetrics = { 'ap-southeast-1': SG_ROUTES };
  const metrics = { 'ap-southeast-1': { ...sg, h_c0: [[T0, 120], [T1, 118]] }, 'ap-northeast-1': { a_count: [[T0, 50]] } };
  const snap = await service(metrics, { listMetrics: { ...listMetrics, 'ap-northeast-1': [dim('/health', 'GET', 'mrapi-api-tyo')] } }).snapshot('1h');
  const [s, t] = snap.regions;
  assert.deepEqual(s.apiGateway.healthCheckRequests, { kind: 'value', value: 238 });
  assert.deepEqual(s.apiGateway.proxyRequests, { kind: 'value', value: 150 });
  assert.equal(s.apiGateway.requests.value, 400);
  // Tokyo: stage có số liệu mà /health không có điểm nào thì là 0 đã đo, không phải missing.
  assert.deepEqual(t.apiGateway.healthCheckRequests, { kind: 'value', value: 0 });
  assert.deepEqual(t.apiGateway.proxyRequests, { kind: 'value', value: 0 });
});

test('tỷ lệ traffic chỉ tính khi cả hai Region có số liệu', async () => {
  const tyo = { a_count: [[T0, 80]], u_c0: [[T0, 50]] };
  const listMetrics = { 'ap-southeast-1': SG_ROUTES, 'ap-northeast-1': [dim('/proxy/{apiId}/{proxy+}', 'ANY', 'mrapi-api-tyo')] };
  const snap = await service({ 'ap-southeast-1': sg, 'ap-northeast-1': tyo }, { listMetrics }).snapshot('1h');
  assert.equal(snap.regions[0].trafficSharePct.value, 75);
  assert.equal(snap.regions[1].trafficSharePct.value, 25);
});

test('nhiều resource /proxy: cộng request, latency có trọng số, p95 lấy cận trên', async () => {
  const listMetrics = { 'ap-southeast-1': [dim('/proxy/{apiId}', 'ANY'), dim('/health', 'GET'), dim('/proxy/{apiId}/{proxy+}', 'ANY')] };
  const metrics = { 'ap-southeast-1': {
    a_count: [[T0, 100]],
    u_c0: [[T0, 10]], u_l0: [[T0, 100]], u_p0: [[T0, 300]], t_p950: [[T0, 300]],
    u_c1: [[T0, 30]], u_l1: [[T0, 20]], u_p1: [[T0, 50]], t_p951: [[T0, 60]],
  } };
  const snap = await service(metrics, { listMetrics }).snapshot('1h');
  const s = snap.regions[0];
  assert.equal(s.requests.value, 40);
  assert.equal(s.latencyAvgMs.value, 40); // (10*100 + 30*20) / 40
  assert.equal(s.latencyP95Ms.value, 300);
  assert.equal(snap.series[0].regions['ap-southeast-1'].latencyP95Ms, 300);
});

test('handler: lỗi cả hai Region trả 502; range sai trả 400; path lạ trả 404', async () => {
  const failing = service({}, { fail: true });
  const call = (path, qs) => handler({ httpMethod: 'GET', path, queryStringParameters: qs }, failing, async () => null);
  assert.equal((await call('/monitoring/snapshot', { range: '1h' })).statusCode, 502);
  assert.equal((await call('/monitoring/snapshot', { range: '9y' })).statusCode, 400);
  assert.equal((await call('/monitoring/other')).statusCode, 404);
  assert.equal((await handler({ httpMethod: 'POST', path: '/monitoring/snapshot' }, failing)).statusCode, 405);
});

test('endpoints chỉ gồm API doanh nghiệp /proxy, bỏ /health, /api, /monitoring và method ngoài hợp đồng', async () => {
  const listMetrics = { 'ap-southeast-1': [
    dim('/health', 'GET'), dim('/api/{proxy+}', 'ANY'), dim('/monitoring/{proxy+}', 'GET'),
    dim('/proxy/{apiId}/{proxy+}', 'ANY'), dim('/proxy/{apiId}', 'OPTIONS'),
  ] };
  // Chỉ số c{i} theo thứ tự sau khi lọc: chỉ còn ANY /proxy/{apiId}/{proxy+}.
  const metrics = { 'ap-southeast-1': { c0: [[T0, 10]], e40: [[T0, 1]], e50: [[T0, 1]], l0: [[T0, 20]] } };
  const stats = await service(metrics, { listMetrics }).endpoints('1h');
  assert.equal(stats.length, 1);
  assert.deepEqual({ ...stats[0], lastUpdated: 0 }, {
    method: 'ANY', path: '/proxy/{apiId}/{proxy+}', region: 'ap-southeast-1', requests: 10,
    successRatePct: 80, errorRatePct: 20, serverErrorRatePct: 10, latencyAvgMs: 20, lastUpdated: 0,
  });
});

const alarmItem = (ts, state) => ({ AlarmName: 'mrapi-sg-5xx', Timestamp: new Date(ts), HistorySummary: `-> ${state}`, HistoryData: JSON.stringify({ newState: { stateValue: state } }) });

test('incidents: alarm ALARM rồi về OK; recoverySeconds đo từ AlarmHistory', async () => {
  const alarmHistory = { 'ap-southeast-1': [alarmItem(T0, 'ALARM'), alarmItem(T1, 'OK')] };
  const events = await service({}, { alarmHistory }).incidents();
  assert.equal(events.length, 1);
  assert.equal(events[0].origin, 'aws');
  assert.equal(events[0].startedAt, T0);
  assert.equal(events[0].endedAt, T1);
  assert.equal(events[0].recoverySeconds, 60);
  assert.deepEqual(events[0].xray, { status: 'not_connected' });
});

test('incidents: alarm chưa về OK thì chưa có thời gian phục hồi', async () => {
  const events = await service({}, { alarmHistory: { 'ap-southeast-1': [alarmItem(T0, 'ALARM')] } }).incidents();
  assert.equal(events[0].endedAt, null);
  assert.equal(events[0].recoverySeconds, null);
});

test('incidents: Route 53 HealthCheckStatus 1→0→1 thành sự kiện traffic_shift có thời gian phục hồi', async () => {
  const m = (k) => T0 + k * 60_000;
  const metrics = { 'us-east-1': { hh0: [[m(0), 1], [m(1), 0], [m(2), 0], [m(3), 0], [m(4), 1], [m(5), 1]] } };
  const events = await service(metrics).incidents();
  assert.equal(events.length, 1);
  const [e] = events;
  assert.equal(e.kind, 'traffic_shift');
  assert.equal(e.region, 'ap-southeast-1');
  assert.equal(e.startedAt, m(1));
  assert.equal(e.endedAt, m(4));
  assert.equal(e.recoverySeconds, 180);
  assert.match(e.title, /Singapore.*Tokyo/);
});

test('incidents: đối chiếu X-Ray trong khoảng sự cố, đúng Region', async () => {
  const calls = [];
  const traceId = (ms, n) => `1-${Math.floor(ms / 1000).toString(16)}-${String(n).padStart(24, '0')}`;
  const xrayFor = (region) => ({
    async getTraceSummaries(input) {
      calls.push({ region, start: input.StartTime.getTime(), end: input.EndTime.getTime() });
      return { TraceSummaries: [
        { Id: traceId(T0 + 5_000, 1), HasFault: true },
        { Id: traceId(T0 + 40_000, 2), HasFault: true, HasError: false },
        { Id: traceId(T0 + 50_000, 3), HasError: true },
        { Id: traceId(T0 + 55_000, 4) },
      ] };
    },
  });
  const alarmHistory = { 'ap-southeast-1': [alarmItem(T0, 'ALARM'), alarmItem(T1, 'OK')] };
  const svc = createService({ clientFor: fakeClients({}, { alarmHistory }), xrayFor, now: () => NOW });
  const [e] = await svc.incidents();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { region: 'ap-southeast-1', start: T0 - 120_000, end: T1 + 120_000 });
  assert.equal(e.xray.status, 'connected');
  assert.equal(e.xray.traces, 4);
  assert.equal(e.xray.faults, 2);
  assert.equal(e.xray.errors, 1);
  assert.equal(e.xray.firstFaultAt, T0 + 5_000);
  assert.equal(e.xray.lastFaultAt, T0 + 40_000);
  assert.deepEqual(e.xray.sampleTraceIds, [traceId(T0 + 5_000, 1), traceId(T0 + 40_000, 2)]);
  assert.match(e.xray.consoleUrl, /^https:\/\/ap-southeast-1\.console\.aws\.amazon\.com\/cloudwatch\/home\?region=ap-southeast-1#xray:traces/);

  const sources = Object.fromEntries((await svc.sources()).map((s) => [s.id, s]));
  assert.equal(sources.xray.status, 'connected');
  assert.match(sources.xray.note, /Singapore: 4 trace/);
});

test('incidents: X-Ray lỗi không làm hỏng sự kiện', async () => {
  const xrayFor = () => ({ async getTraceSummaries() { throw Object.assign(new Error('x'), { name: 'AccessDeniedException' }); } });
  const alarmHistory = { 'ap-southeast-1': [alarmItem(T0, 'ALARM'), alarmItem(T1, 'OK')] };
  const svc = createService({ clientFor: fakeClients({}, { alarmHistory }), xrayFor, now: () => NOW });
  const [e] = await svc.incidents();
  assert.equal(e.recoverySeconds, 60);
  assert.deepEqual(e.xray, { status: 'error', detail: 'AccessDeniedException' });
  const sources = Object.fromEntries((await svc.sources()).map((s) => [s.id, s]));
  assert.equal(sources.xray.status, 'error');
});

test('sources: X-Ray not_connected, Route 53 lỗi khi không đọc được HealthCheckStatus, S3 cả hai Region', async () => {
  const list = await service({ 'ap-southeast-1': sg, 'ap-northeast-1': S3_SG_TO_TYO }).sources();
  const byId = Object.fromEntries(list.map((s) => [s.id, s]));
  assert.equal(byId.route53.status, 'error');
  assert.equal(byId.xray.status, 'not_connected');
  assert.equal(byId['api-gateway'].status, 'connected');
  assert.match(byId['s3-replication'].note, /Singapore: có dữ liệu trong 1 giờ qua/);
  assert.doesNotMatch(byId['s3-replication'].note, /not_configured/);
});
