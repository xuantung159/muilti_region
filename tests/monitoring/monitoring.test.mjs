import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createService, handler } from '../../src/monitoring/index.mjs';

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

const sg = {
  a_count: [[T0, 100], [T1, 50]], a_e4: [[T0, 2], [T1, 1]], a_e5: [[T0, 1], [T1, 0]],
  a_lat: [[T0, 40], [T1, 60]], a_p95: [[T0, 90], [T1, 100]], t_p95: [[T0, 95]],
  l_inv: [[T0, 100], [T1, 50]], l_err: [[T0, 1], [T1, 0]], l_dur: [[T0, 30], [T1, 30]],
  d_rep: [[T0, 800], [T1, 1000]], s_rep: [[T0, 20]],
};
const service = (metrics, extra) => createService({ clientFor: fakeClients(metrics, extra), now: () => NOW });

test('snapshot SG có số liệu thật; Tokyo không có dữ liệu thì missing, không phải 0', async () => {
  const snap = await service({ 'ap-southeast-1': sg }).snapshot('1h');
  const [s, t] = snap.regions;
  assert.equal(snap.dataMode, 'live');
  assert.equal(s.requests.value, 150);
  assert.equal(s.errorRatePct.value, 2.67);
  assert.equal(s.successRatePct.value, 97.33);
  assert.equal(s.latencyAvgMs.value, 47); // trung bình có trọng số theo số request
  assert.equal(s.latencyP95Ms.value, 95);
  assert.equal(s.lambda.invocations.value, 150);
  assert.equal(s.lambda.errors.value, 1);
  assert.equal(s.apiGateway.error4xx.value, 3);
  assert.equal(s.dynamodbReplicationLatencyMs.value, 900);
  assert.equal(s.s3ReplicationLatencyS.value, 20);
  assert.deepEqual(s.healthCheck, { kind: 'missing', reason: 'not_connected' });
  assert.deepEqual(t.requests, { kind: 'missing', reason: 'unavailable' });
  assert.deepEqual(t.s3ReplicationLatencyS, { kind: 'missing', reason: 'not_configured' });
  assert.deepEqual(s.trafficSharePct, { kind: 'missing', reason: 'unavailable' }); // thiếu dữ liệu Tokyo thì không báo 100%
  assert.equal(snap.series.length, 2);
  assert.equal(snap.series[0].regions['ap-southeast-1'].success, 97);
  assert.equal(snap.series[0].regions['ap-northeast-1'].requests, 0);
});

test('tỷ lệ traffic chỉ tính khi cả hai Region có số liệu', async () => {
  const tyo = { a_count: [[T0, 50]] };
  const snap = await service({ 'ap-southeast-1': sg, 'ap-northeast-1': tyo }).snapshot('1h');
  assert.equal(snap.regions[0].trafficSharePct.value, 75);
  assert.equal(snap.regions[1].trafficSharePct.value, 25);
});

test('handler: lỗi cả hai Region trả 502; range sai trả 400; path lạ trả 404', async () => {
  const failing = service({}, { fail: true });
  const call = (path, qs) => handler({ httpMethod: 'GET', path, queryStringParameters: qs }, failing);
  assert.equal((await call('/monitoring/snapshot', { range: '1h' })).statusCode, 502);
  assert.equal((await call('/monitoring/snapshot', { range: '9y' })).statusCode, 400);
  assert.equal((await call('/monitoring/other')).statusCode, 404);
  assert.equal((await handler({ httpMethod: 'POST', path: '/monitoring/snapshot' }, failing)).statusCode, 405);
});

test('endpoints lấy theo resource và method, bỏ method ngoài hợp đồng', async () => {
  const dim = (resource, method) => ({ Dimensions: [{ Name: 'ApiName', Value: 'mrapi-api-sg' }, { Name: 'Stage', Value: 'demo' }, { Name: 'Resource', Value: resource }, { Name: 'Method', Value: method }] });
  const listMetrics = { 'ap-southeast-1': [dim('/health', 'GET'), dim('/api/{proxy+}', 'PATCH')] };
  const metrics = { 'ap-southeast-1': { c0: [[T0, 10]], e40: [[T0, 1]], e50: [[T0, 1]], l0: [[T0, 20]] } };
  const stats = await service(metrics, { listMetrics }).endpoints('1h');
  assert.equal(stats.length, 1);
  assert.deepEqual({ ...stats[0], lastUpdated: 0 }, {
    method: 'GET', path: '/health', region: 'ap-southeast-1', requests: 10,
    successRatePct: 80, errorRatePct: 20, latencyAvgMs: 20, lastUpdated: 0,
  });
});

test('incidents: alarm vào ALARM rồi về OK; origin aws, recoverySeconds để null', async () => {
  const item = (ts, state) => ({ AlarmName: 'mrapi-sg-5xx', Timestamp: new Date(ts), HistorySummary: `-> ${state}`, HistoryData: JSON.stringify({ newState: { stateValue: state } }) });
  const alarmHistory = { 'ap-southeast-1': [item(T0, 'ALARM'), item(T1, 'OK')] };
  const events = await service({}, { alarmHistory }).incidents();
  assert.equal(events.length, 1);
  assert.equal(events[0].origin, 'aws');
  assert.equal(events[0].startedAt, T0);
  assert.equal(events[0].endedAt, T1);
  assert.equal(events[0].recoverySeconds, null);
});

test('sources: Route 53 và X-Ray not_connected, S3 chỉ tính Singapore', async () => {
  const list = await service({ 'ap-southeast-1': sg }).sources();
  const byId = Object.fromEntries(list.map((s) => [s.id, s]));
  assert.equal(byId.route53.status, 'not_connected');
  assert.equal(byId.xray.status, 'not_connected');
  assert.equal(byId['api-gateway'].status, 'connected');
  assert.match(byId['s3-replication'].note, /Tokyo: not_configured/);
});
