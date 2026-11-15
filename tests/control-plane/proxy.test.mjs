import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
process.env.CONTROL_TABLE = 'mrapi-control';
process.env.TELEMETRY_TABLE = 'mrapi-telemetry';
const { db } = await import('../../src/shared/lib.mjs');
const { handler } = await import('../../src/api/index.mjs');
const { transport, targetUrl, MAX_RESPONSE_BYTES, upstreamAgent } = await import('../../src/api/proxy.mjs');
const { safeLookup, isBlockedAddress } = await import('../../src/api/target.mjs');
const realRequest = transport.request;

const tenantId = 't0123456789';
const apiId = `a${'1'.repeat(32)}`;
let api; let telemetry; let sent; let upstream;
beforeEach(() => {
  api = { apiId, tenantId, baseUrl: 'https://backend.company.com/v1', timeoutMs: 1000, enabled: true };
  telemetry = []; sent = null;
  upstream = { status: 200, headers: { 'content-type': 'application/json' }, body: '{"ok":true}' };
  db.send = async command => {
    if (command.constructor.name === 'GetCommand') {
      assert.deepEqual(command.input.Key, { PK: `TENANT#${tenantId}`, SK: `API#${apiId}` });
      return { Item: api && structuredClone(api) };
    }
    if (command.constructor.name === 'PutCommand') { telemetry.push(command.input); return {}; }
    throw new Error(`Unexpected ${command.constructor.name}`);
  };
  // Backend giả: ghi lại request nhận được và trả `upstream`.
  transport.request = (url, options, onResponse) => {
    const req = new EventEmitter();
    req.destroy = () => {};
    req.end = body => {
      sent = { url: String(url), options, body: body.toString() };
      if (upstream.error) return setImmediate(() => req.emit('error', Object.assign(new Error('x'), { code: upstream.error })));
      if (upstream.hang) return;
      const res = new PassThrough();
      Object.assign(res, { statusCode: upstream.status, headers: upstream.headers });
      onResponse(res);
      res.end(upstream.body);
    };
    return req;
  };
});

const call = (path, extra = {}) => handler({
  httpMethod: 'POST', path, headers: { 'x-api-key': 'secret-gateway-key', Authorization: 'Bearer portal', 'X-Custom': 'yes', 'Content-Type': 'application/json' },
  multiValueQueryStringParameters: { q: ['a b', 'c'] }, body: '{"n":1}',
  requestContext: { requestId: 'req-1', authorizer: { tenant_id: tenantId, key_id: 'abcdef012345' } }, ...extra,
});

test('forwards method, path, query and body; strips gateway secrets; returns backend response', async () => {
  const result = await call(`/proxy/${apiId}/orders/42`);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body, '{"ok":true}');
  assert.equal(result.headers['X-Mrapi-Source'], 'upstream');
  assert.equal(sent.url, 'https://backend.company.com/v1/orders/42?q=a+b&q=c');
  assert.equal(sent.options.method, 'POST');
  assert.equal(sent.body, '{"n":1}');
  assert.equal(sent.options.headers['x-custom'], 'yes');
  assert.equal(sent.options.headers['x-api-key'], undefined);
  assert.equal(sent.options.headers.authorization, undefined);
  assert.equal(sent.options.lookup, safeLookup);
  const [{ TableName, Item }] = telemetry;
  assert.equal(TableName, 'mrapi-telemetry');
  assert.equal(Item.PK, `TENANT#${tenantId}`);
  assert.match(Item.SK, /^\d{4}-\d\d-\d\dT.*Z#req-1$/);
  assert.equal(Item.path, '/orders/42');
  assert.equal(Item.status, 200);
  assert.equal(Item.GSI1PK, undefined);
  assert.ok(Item.expiresAt > Date.now() / 1000 && Item.expiresAt < Date.now() / 1000 + 31 * 86400);
});

test('backend errors pass through; 5xx is tagged in telemetry; 4xx is not', async () => {
  upstream = { status: 503, headers: { 'content-type': 'text/plain' }, body: 'down' };
  assert.equal((await call(`/proxy/${apiId}/x`)).statusCode, 503);
  assert.equal(telemetry[0].Item.errorType, 'UPSTREAM_5XX');
  assert.equal(telemetry[0].Item.GSI1PK, `TENANT#${tenantId}#ERR`);
  upstream = { status: 404, headers: {}, body: '' };
  assert.equal((await call(`/proxy/${apiId}/x`)).statusCode, 404);
  assert.equal(telemetry[1].Item.errorType, undefined);
});

test('gateway errors: unknown or disabled API, bad path, timeout, unreachable, oversized', async () => {
  const code = async (path, extra) => { const r = await call(path, extra); return [r.statusCode, JSON.parse(r.body).code, r.headers['X-Mrapi-Source']]; };
  api.enabled = false;
  assert.deepEqual(await code(`/proxy/${apiId}/x`), [403, 'API_DISABLED', 'gateway']);
  api = undefined;
  assert.deepEqual(await code(`/proxy/${apiId}/x`), [404, 'API_NOT_FOUND', 'gateway']);
  assert.deepEqual(await code('/proxy/not-an-id/x'), [404, 'API_NOT_FOUND', 'gateway']);
  api = { apiId, tenantId, baseUrl: 'https://backend.company.com/v1', timeoutMs: 1000, enabled: true };
  assert.deepEqual(await code(`/proxy/${apiId}/%2e%2e/admin`), [400, 'BAD_PATH', 'gateway']);
  assert.deepEqual(await code(`/proxy/${apiId}/x`, { body: 'x'.repeat(1024 * 1024 + 1) }), [413, 'PAYLOAD_TOO_LARGE', 'gateway']);
  upstream = { error: 'ECONNREFUSED' };
  assert.deepEqual(await code(`/proxy/${apiId}/x`), [502, 'UPSTREAM_UNREACHABLE', 'gateway']);
  upstream = { hang: true };
  api.timeoutMs = 50;
  assert.deepEqual(await code(`/proxy/${apiId}/x`), [504, 'UPSTREAM_TIMEOUT', 'gateway']);
  upstream = { status: 200, headers: {}, body: Buffer.alloc(MAX_RESPONSE_BYTES + 1) };
  assert.deepEqual(await code(`/proxy/${apiId}/x`), [502, 'UPSTREAM_TOO_LARGE', 'gateway']);
  assert.deepEqual(telemetry.map(t => t.Item.errorType), ['API_DISABLED', 'API_NOT_FOUND', 'API_NOT_FOUND', 'BAD_PATH', 'PAYLOAD_TOO_LARGE', 'UPSTREAM_UNREACHABLE', 'UPSTREAM_TIMEOUT', 'UPSTREAM_TOO_LARGE']);
});

test('request without authorizer context is refused and not forwarded', async () => {
  const result = await call(`/proxy/${apiId}/x`, { requestContext: { requestId: 'req-2' } });
  assert.equal(result.statusCode, 500);
  assert.equal(sent, null);
});

test('binary responses are base64; telemetry failure still returns the response', async () => {
  upstream = { status: 200, headers: { 'content-type': 'image/png' }, body: Buffer.from([0, 1, 2]) };
  db.send = async command => {
    if (command.constructor.name === 'GetCommand') return { Item: structuredClone(api) };
    throw Object.assign(new Error('denied'), { name: 'AccessDeniedException' });
  };
  const result = await call(`/proxy/${apiId}/logo.png`);
  assert.equal(result.statusCode, 200);
  assert.equal(result.isBase64Encoded, true);
  assert.equal(result.body, 'AAEC');
});

test('target URL keeps base path and rejects dot segments', () => {
  assert.equal(targetUrl('https://b.company.com/v1', ['a%20b', 'c'], { path: '/proxy/x/a%20b/c/' }).href, 'https://b.company.com/v1/a%20b/c/');
  assert.equal(targetUrl('https://b.company.com', [], { path: '/proxy/x' }).href, 'https://b.company.com/');
  assert.equal(targetUrl('https://b.company.com/v1', ['..'], {}), null);
});

test('private, loopback, metadata and reserved addresses are blocked; public ones are not', () => {
  for (const ip of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.5.4', '192.168.1.1', '100.64.0.1', '0.0.0.0', '::1', '::ffff:127.0.0.1', 'fd00::1', 'fe80::1', '64:ff9b::a00:1']) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) assert.equal(isBlockedAddress(ip), false, ip);
});

test('DNS pointing at a private address is blocked before any connection (real https)', async () => {
  transport.request = realRequest;
  api.baseUrl = 'https://localhost';
  const result = await call(`/proxy/${apiId}/x`);
  assert.equal(result.statusCode, 403);
  assert.equal(JSON.parse(result.body).code, 'TARGET_BLOCKED');
});

// Backend giả theo từng lần gọi: `plan` là danh sách hành vi cho lần gọi 1, 2, ...
function scripted(plan) {
  const calls = [];
  transport.request = (url, options, onResponse) => {
    const step = plan[calls.length] ?? plan.at(-1);
    calls.push({ agent: options.agent, lookup: options.lookup });
    const req = new EventEmitter();
    req.destroy = () => {};
    req.reusedSocket = step.reused ?? false;
    req.end = () => setImmediate(() => {
      if (step.error) return req.emit('error', Object.assign(new Error(step.error), { code: step.error }));
      const res = new PassThrough();
      Object.assign(res, { statusCode: 200, headers: {}, body: '' });
      onResponse(res);
      res.end('ok');
    });
    return req;
  };
  return calls;
}

test('idempotent methods reuse the keep-alive agent; POST and PATCH open a fresh connection', async () => {
  const calls = scripted([{}]);
  for (const httpMethod of ['GET', 'PUT', 'DELETE', 'POST', 'PATCH']) await call(`/proxy/${apiId}/x`, { httpMethod });
  assert.deepEqual(calls.map(c => c.agent === upstreamAgent), [true, true, true, false, false]);
  assert.ok(calls.every(c => c.lookup === safeLookup));
});

test('a reused socket closed by the backend is retried once on a fresh connection', async () => {
  const calls = scripted([{ reused: true, error: 'ECONNRESET' }, {}]);
  const result = await call(`/proxy/${apiId}/x`, { httpMethod: 'GET' });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(calls.map(c => c.agent === upstreamAgent), [true, false]);
  assert.equal(telemetry.length, 1);
});

test('no retry for a fresh connection, a POST, or a second failure', async () => {
  let calls = scripted([{ reused: false, error: 'ECONNRESET' }]);
  assert.equal((await call(`/proxy/${apiId}/x`, { httpMethod: 'GET' })).statusCode, 502);
  assert.equal(calls.length, 1);
  calls = scripted([{ reused: true, error: 'ECONNRESET' }]);
  assert.equal((await call(`/proxy/${apiId}/x`, { httpMethod: 'POST' })).statusCode, 502);
  assert.equal(calls.length, 1);
  calls = scripted([{ reused: true, error: 'ECONNRESET' }, { reused: false, error: 'ECONNRESET' }]);
  assert.equal((await call(`/proxy/${apiId}/x`, { httpMethod: 'GET' })).statusCode, 502);
  assert.equal(calls.length, 2);
});

test('keep-alive agent still blocks private DNS targets (real https, GET)', async () => {
  transport.request = realRequest;
  api.baseUrl = 'https://localhost';
  const result = await call(`/proxy/${apiId}/x`, { httpMethod: 'GET' });
  assert.equal(result.statusCode, 403);
  assert.equal(JSON.parse(result.body).code, 'TARGET_BLOCKED');
});
