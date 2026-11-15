import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.CONTROL_TABLE = 'control';
process.env.TELEMETRY_TABLE = 'telemetry';
const { db } = await import('../../src/shared/lib.mjs');
const { handler } = await import('../../src/dashboard/index.mjs');
const { buildReport, isGatewayError } = await import('../../src/dashboard/report.mjs');

const NOW = Date.parse('2026-11-10T12:00:30Z');
const at = (minAgo) => new Date(NOW - minAgo * 60_000).toISOString();
const rec = (o) => ({ timestamp: at(1), status: 200, latencyMs: 100, region: 'ap-southeast-1', keyId: 'aaaaaaaaaaaa',
  apiId: 'a1', method: 'GET', path: '/todos/1', country: 'VN', ...o });

test('buildReport tách theo Region, quốc gia, endpoint và phân biệt lỗi gateway với lỗi backend', () => {
  const items = [
    rec({}),
    rec({ status: 502, errorType: 'UPSTREAM_UNREACHABLE', latencyMs: 3000 }),
    rec({ status: 500, errorType: 'GATEWAY_INTERNAL' }),
    rec({ status: 404, errorType: 'API_NOT_FOUND', region: 'ap-northeast-1', country: 'JP' }),
    rec({ keyId: 'bbbbbbbbbbbb', region: 'ap-northeast-1', country: 'US' }),
    rec({ timestamp: at(120) }), // ngoài khoảng 1h
    rec({ region: 'eu-west-1' }), // Region lạ bị bỏ
  ];
  const all = buildReport(items, '1h', NOW);
  const sg = all.regions.find((r) => r.region === 'ap-southeast-1');
  assert.deepEqual([sg.requests, sg.error5xx, sg.gatewayErrors, sg.upstreamErrors], [3, 2, 1, 1]);
  assert.equal(all.series.length, 60);
  assert.equal(all.series.reduce((s, p) => s + p.regions['ap-southeast-1'].requests, 0), 3);
  assert.deepEqual(all.routes.map((r) => `${r.country}>${r.servedRegion}:${r.requests}`), ['VN>ap-southeast-1:3', 'JP>ap-northeast-1:1', 'US>ap-northeast-1:1']);
  assert.equal(all.endpoints[0].requests, 3);
  assert.equal(all.endpoints[0].gatewayErrorRatePct, 33.33);

  const one = buildReport(items, '1h', NOW, 'bbbbbbbbbbbb');
  assert.deepEqual(one.regions.map((r) => r.requests), [0, 1]);
  assert.deepEqual(one.routes.map((r) => r.country), ['US']);
  assert.equal(isGatewayError({ status: 504, errorType: 'UPSTREAM_TIMEOUT' }), false);
});

test('/api/report chỉ đọc telemetry của doanh nghiệp trong phiên và từ chối key không thuộc doanh nghiệp', async () => {
  const queried = [];
  db.send = async (command) => {
    const input = command.input;
    if (command.constructor.name === 'GetCommand') return { Item: { tenantId: 'tenant-a', expiresAt: Date.now() / 1000 + 60 } };
    queried.push(input);
    if (input.TableName === 'control') return { Items: [{ keyId: 'aaaaaaaaaaaa', name: 'project_test', status: 'active', keyHash: 'secret-hash' }] };
    return { Items: [rec({ timestamp: new Date().toISOString() }), rec({ timestamp: new Date().toISOString(), keyId: 'cccccccccccc' })] };
  };
  const call = (qs) => handler({ httpMethod: 'GET', path: '/api/report', queryStringParameters: qs,
    headers: { Authorization: `Bearer ${'f'.repeat(64)}` } });

  const ok = await call({ range: '1h', keyId: 'aaaaaaaaaaaa' });
  assert.equal(ok.statusCode, 200);
  const body = JSON.parse(ok.body);
  assert.equal(body.keyId, 'aaaaaaaaaaaa');
  assert.equal(body.regions.find((r) => r.region === 'ap-southeast-1').requests, 1);
  assert.deepEqual(body.keys, [{ keyId: 'aaaaaaaaaaaa', name: 'project_test', status: 'active' }]);
  assert.ok(!ok.body.includes('secret-hash'));
  assert.ok(queried.filter((q) => q.TableName === 'telemetry').every((q) => q.ExpressionAttributeValues[':pk'] === 'TENANT#tenant-a'));

  assert.equal((await call({ range: '1h' })).statusCode, 200);
  assert.equal((await call({ range: '1h', keyId: 'cccccccccccc' })).statusCode, 404);
  assert.equal((await call({ range: '2h' })).statusCode, 400);
});

test('key mới tạo chưa gửi request: báo cáo bằng 0, không lẫn traffic hệ thống (health check, portal)', () => {
  // Telemetry chỉ có bản ghi /proxy của key khác trong doanh nghiệp; health check không bao giờ ghi telemetry.
  const items = [rec({ keyId: 'aaaaaaaaaaaa' })];
  const fresh = buildReport(items, '24h', NOW, 'dddddddddddd');
  assert.deepEqual(fresh.regions.map((r) => r.requests), [0, 0]);
  assert.ok(fresh.series.every((p) => p.regions['ap-southeast-1'].requests === 0 && p.regions['ap-northeast-1'].requests === 0));
  assert.deepEqual(fresh.endpoints, []);
  assert.deepEqual(fresh.routes, []);
  assert.deepEqual(buildReport([], '24h', NOW).regions.map((r) => r.requests), [0, 0]);
});
