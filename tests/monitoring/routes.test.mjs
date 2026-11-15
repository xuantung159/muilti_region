import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createService, handleRequest } from '../../src/monitoring/index.mjs';

const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);
const T = NOW - 10 * 60_000;
const routeDim = (country, servedRegion) => ({ Dimensions: [{ Name: 'Country', Value: country }, { Name: 'ServedRegion', Value: servedRegion }] });

// Mỗi Region chỉ có metric do chính Lambda ở Region đó ghi.
const fake = (lists, values, failRegion) => (region) => ({
  async send(command) {
    if (region === failRegion) throw Object.assign(new Error('x'), { name: 'AccessDeniedException' });
    const name = command.constructor.name;
    if (name === 'ListMetricsCommand') {
      assert.equal(command.input.Namespace, 'MRAPI/Routing');
      return { Metrics: lists[region] ?? [] };
    }
    if (name === 'GetMetricDataCommand') {
      return { MetricDataResults: command.input.MetricDataQueries.flatMap((q) => {
        const dims = Object.fromEntries(q.MetricStat.Metric.Dimensions.map((d) => [d.Name, d.Value]));
        const v = values[`${dims.Country}|${dims.ServedRegion}`];
        assert.equal(q.MetricStat.Period, 60); // khoảng 1h dùng ô 1 phút
        // Chia làm hai ô để kiểm tra cộng dồn và lastSeen là ô muộn nhất.
        return v === undefined ? [] : [{ Id: q.Id, Timestamps: [new Date(T - 120_000), new Date(T)], Values: [v - 1, 1] }];
      }) };
    }
    throw new Error(`unexpected ${name}`);
  },
});

test('routes gộp quốc gia → Region phục vụ từ cả hai Region, sắp theo số request', async () => {
  const lists = {
    'ap-southeast-1': [routeDim('VN', 'ap-southeast-1'), routeDim('DE', 'ap-southeast-1'), routeDim('bad', 'ap-southeast-1')],
    'ap-northeast-1': [routeDim('US', 'ap-northeast-1'), routeDim('KR', 'ap-northeast-1'), routeDim('US', 'eu-west-1')],
  };
  const values = { 'VN|ap-southeast-1': 11, 'US|ap-northeast-1': 20, 'DE|ap-southeast-1': 3 }; // KR không có điểm trong khoảng
  const routes = await createService({ clientFor: fake(lists, values), now: () => NOW }).routes('1h');
  assert.deepEqual(routes.map(({ lastSeen, ...r }) => r), [
    { country: 'US', servedRegion: 'ap-northeast-1', requests: 20 },
    { country: 'VN', servedRegion: 'ap-southeast-1', requests: 11 },
    { country: 'DE', servedRegion: 'ap-southeast-1', requests: 3 },
  ]);
  assert.equal(routes[0].lastSeen, T);
});

test('routes: một Region lỗi vẫn trả dữ liệu Region còn lại; chưa có metric thì mảng rỗng', async () => {
  const lists = { 'ap-southeast-1': [routeDim('VN', 'ap-southeast-1')] };
  const routes = await createService({ clientFor: fake(lists, { 'VN|ap-southeast-1': 5 }, 'ap-northeast-1'), now: () => NOW }).routes('1h');
  assert.equal(routes.length, 1);
  assert.equal(routes[0].requests, 5);
  assert.deepEqual(await createService({ clientFor: fake({}, {}), now: () => NOW }).routes('1h'), []);
});

test('handler phục vụ GET /monitoring/routes', async () => {
  const service = { routes: async (range) => [{ country: 'VN', servedRegion: 'ap-southeast-1', requests: 1, lastSeen: 0, range }] };
  const res = await handleRequest({ httpMethod: 'GET', path: '/monitoring/routes', queryStringParameters: { range: '24h' } }, service, async () => null);
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body)[0].range, '24h');
});
