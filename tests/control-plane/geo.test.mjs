import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
process.env.CONTROL_TABLE = 'mrapi-control';
process.env.TELEMETRY_TABLE = 'mrapi-telemetry';
const { countryOf, routingMetric, UNKNOWN_COUNTRY } = await import('../../src/api/geo.mjs');
const { db } = await import('../../src/shared/lib.mjs');
const { handler } = await import('../../src/api/index.mjs');
const { transport } = await import('../../src/api/proxy.mjs');

test('countryOf dùng dữ liệu GeoLite2 offline: IP Mỹ, Việt Nam, Đức; IP nội bộ/thiếu là ZZ', () => {
  assert.equal(countryOf('34.204.203.50'), 'US'); // CloudShell us-east-1
  assert.equal(countryOf('14.161.0.1'), 'VN');
  assert.equal(countryOf('3.78.206.104'), 'DE');
  assert.equal(countryOf('127.0.0.1'), UNKNOWN_COUNTRY);
  assert.equal(countryOf(undefined), UNKNOWN_COUNTRY);
  assert.equal(countryOf('1.2.3.4', { lookup: () => { throw new Error('db hỏng'); } }), UNKNOWN_COUNTRY);
  assert.equal(countryOf('1.2.3.4', { lookup: () => ({ country: 'bad' }) }), UNKNOWN_COUNTRY);
});

test('routingMetric đúng Embedded Metric Format: namespace, dimension và giá trị 1', () => {
  const m = routingMetric('US', 'ap-northeast-1', 1000);
  assert.deepEqual(m._aws.CloudWatchMetrics[0], {
    Namespace: 'MRAPI/Routing', Dimensions: [['Country', 'ServedRegion']], Metrics: [{ Name: 'Requests', Unit: 'Count' }],
  });
  assert.equal(m._aws.Timestamp, 1000);
  assert.deepEqual({ c: m.Country, r: m.ServedRegion, n: m.Requests }, { c: 'US', r: 'ap-northeast-1', n: 1 });
});

test('proxy ghi quốc gia vào telemetry và log metric, không ghi IP nguồn', async () => {
  const apiId = `a${'1'.repeat(32)}`;
  const telemetry = [];
  db.send = async (command) => {
    if (command.constructor.name === 'GetCommand') return { Item: { apiId, baseUrl: 'https://backend.company.com', timeoutMs: 1000, enabled: true } };
    if (command.constructor.name === 'PutCommand') { telemetry.push(command.input.Item); return {}; }
    throw new Error('unexpected');
  };
  transport.request = (_url, _options, onResponse) => ({
    on() {}, destroy() {},
    end() {
      const res = new PassThrough();
      Object.assign(res, { statusCode: 200, headers: { 'content-type': 'text/plain' } });
      onResponse(res); res.end('ok');
    },
  });
  const logs = [];
  const original = console.log;
  console.log = (line) => logs.push(line);
  try {
    const result = await handler({
      httpMethod: 'GET', path: `/proxy/${apiId}/x`, headers: {},
      requestContext: { requestId: 'r-geo', identity: { sourceIp: '34.204.203.50' }, authorizer: { tenant_id: 't0123456789', key_id: 'abcdef012345' } },
    });
    assert.equal(result.statusCode, 200);
  } finally { console.log = original; }
  assert.equal(telemetry[0].country, 'US');
  const all = JSON.stringify(telemetry) + logs.join('\n');
  assert.ok(!all.includes('34.204.203.50'), 'không được lưu IP nguồn');
  const emf = logs.map((l) => JSON.parse(l)).find((l) => l._aws);
  assert.equal(emf.Country, 'US');
  assert.equal(emf.Requests, 1);
});
