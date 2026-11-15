// Cache cấu hình API (opt-in qua API_CONFIG_CACHE_MS). Mặc định tắt; file này bật để kiểm hành vi khi bật.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
process.env.CONTROL_TABLE = 'mrapi-control';
process.env.TELEMETRY_TABLE = 'mrapi-telemetry';
process.env.API_CONFIG_CACHE_MS = '200';
console.log = () => {};
const { db } = await import('../../src/shared/lib.mjs');
const { handler } = await import('../../src/api/index.mjs');
const { transport } = await import('../../src/api/proxy.mjs');

const tenantId = 't0123456789';
const apiId = `a${'3'.repeat(32)}`;
let api; let gets = 0;
db.send = async command => {
  if (command.constructor.name === 'GetCommand') { gets += 1; return { Item: api && structuredClone(api) }; }
  return {};
};
transport.request = (url, options, onResponse) => {
  const req = new EventEmitter();
  req.destroy = () => {};
  req.end = () => setImmediate(() => { const res = new PassThrough(); Object.assign(res, { statusCode: 200, headers: {} }); onResponse(res); res.end('ok'); });
  return req;
};
const call = () => handler({
  httpMethod: 'GET', path: `/proxy/${apiId}/x`, headers: {},
  requestContext: { requestId: 'r', authorizer: { tenant_id: tenantId, key_id: 'abcdef012345' } },
}).then(r => r.statusCode);

test('không cache "không tìm thấy": API vừa tạo dùng được ngay', async () => {
  api = undefined;
  assert.equal(await call(), 404);
  api = { apiId, tenantId, baseUrl: 'https://b.company.com', enabled: true, timeoutMs: 1000 };
  assert.equal(await call(), 200);
  assert.equal(gets, 2);
});

test('trong TTL dùng cache; hết TTL đọc lại và thấy API đã tắt', async () => {
  gets = 0;
  assert.equal(await call(), 200); // cache từ test trước còn hạn
  api.enabled = false;
  assert.equal(await call(), 200); // cũ tối đa API_CONFIG_CACHE_MS
  assert.equal(gets, 0);
  await new Promise(r => setTimeout(r, 250));
  assert.equal(await call(), 403);
  assert.equal(gets, 1);
});
