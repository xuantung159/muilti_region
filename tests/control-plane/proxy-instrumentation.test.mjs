// Đo đạc của proxy (schemaVersion 2) với backend giả chạy thật trên máy (HTTP 127.0.0.1).
// transport.request được nối sang node:http vì safeLookup (đúng thiết kế) chặn mọi địa chỉ loopback;
// phần SSRF đã có test riêng trong proxy.test.mjs.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer, request as httpRequest, Agent as HttpAgent } from 'node:http';
import { PassThrough } from 'node:stream';
import { randomBytes } from 'node:crypto';
process.env.CONTROL_TABLE = 'mrapi-control';
process.env.TELEMETRY_TABLE = 'mrapi-telemetry';
process.env.TELEMETRY_WRITE_TIMEOUT_MS = '150';
process.env.AWS_REGION = 'ap-southeast-1'; // Lambda luôn đặt biến này
const { db } = await import('../../src/shared/lib.mjs');
const { handler } = await import('../../src/api/index.mjs');
const { transport, upstreamAgent, TELEMETRY_SCHEMA_VERSION } = await import('../../src/api/proxy.mjs');
const { ERROR_CLASSES } = await import('../../src/shared/errors.mjs');

const API_KEY = 'mrk_t0123456789_abcdef012345_' + 'f'.repeat(48);
const tenantId = 't0123456789';
const apiId = `a${'2'.repeat(32)}`;
const binary = randomBytes(4096);
const unicode = '{"name":"Phở bò ✓","emoji":"🚀"}';

let server; let port; let closedPort;
const keepAlive = new HttpAgent({ keepAlive: true });
const routes = {
  '/ok': (req, res) => { res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }); res.end(unicode); },
  '/echo': (req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => { res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.end(Buffer.concat(chunks)); });
  },
  '/binary': (req, res) => { res.writeHead(200, { 'content-type': 'image/png' }); res.end(binary); },
  '/fail': (req, res) => { res.writeHead(500, { 'content-type': 'text/plain' }); res.end('backend exploded'); },
  '/slow': (req, res) => { setTimeout(() => { if (!res.destroyed) { res.writeHead(200); res.end('late'); } }, 1000); },
  '/huge': (req, res) => { res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.end(Buffer.alloc(4 * 1024 * 1024 + 10)); },
};

before(async () => {
  server = createServer((req, res) => (routes[new URL(req.url, 'http://x').pathname] ?? ((q, s) => { s.writeHead(404); s.end(); }))(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  const tmp = createServer();
  await new Promise(resolve => tmp.listen(0, '127.0.0.1', resolve));
  closedPort = tmp.address().port;
  await new Promise(resolve => tmp.close(resolve));
});
after(() => { keepAlive.destroy(); server.closeAllConnections?.(); server.close(); });

let api; let telemetry; let logs; let targetPort;
const realLog = console.log; const realError = console.error;
beforeEach(() => {
  api = { apiId, tenantId, baseUrl: 'https://backend.company.com/v1', timeoutMs: 2000, enabled: true };
  telemetry = []; logs = []; targetPort = port;
  db.send = async command => {
    if (command.constructor.name === 'GetCommand') return { Item: structuredClone(api) };
    if (command.constructor.name === 'PutCommand') { telemetry.push(command.input.Item); return {}; }
    throw new Error(`Unexpected ${command.constructor.name}`);
  };
  // Giữ nguyên method, header, body, agent (pool keep-alive ↔ agent HTTP keep-alive riêng của test).
  transport.request = (url, options, onResponse) => httpRequest({
    host: '127.0.0.1', port: targetPort, path: url.pathname.replace(/^\/v1/, '') + url.search,
    method: options.method, headers: options.headers, agent: options.agent === upstreamAgent ? keepAlive : false,
  }, onResponse);
});

async function call(path, extra = {}) {
  console.log = (...args) => logs.push(args.map(String).join(' '));
  console.error = (...args) => logs.push(args.map(String).join(' '));
  try {
    return await handler({
      httpMethod: 'GET', path: `/proxy/${apiId}${path}`,
      headers: { 'x-api-key': API_KEY, Authorization: 'Bearer portal-session-token', 'Content-Type': 'application/json' },
      requestContext: { requestId: 'req-instr', authorizer: { tenant_id: tenantId, key_id: 'abcdef012345' }, identity: { sourceIp: '14.161.0.1' } },
      ...extra,
    });
  } finally {
    console.log = realLog; console.error = realError;
  }
}

const assertNoNullish = item => {
  for (const [k, v] of Object.entries(item)) assert.ok(v !== null && v !== undefined, `${k} is ${v}`);
};
const assertIntMs = (item, ...fields) => {
  for (const f of fields) assert.ok(Number.isInteger(item[f]) && item[f] >= 0, `${f}=${item[f]}`);
};

test('cold start: true ở request đầu của container, false sau đó', async () => {
  await call('/ok');
  await call('/ok');
  assert.deepEqual(telemetry.map(i => i.coldStart), [true, false]);
});

test('thành công: body UTF-8 giữ nguyên, item schemaVersion 2 đủ timing, không null, gatewayMs = latencyMs − upstreamMs', async () => {
  const result = await call('/ok');
  assert.equal(result.statusCode, 200);
  assert.equal(result.body, unicode);
  assert.equal(result.isBase64Encoded, false);
  assert.equal(result.headers['X-Request-Id'], 'req-instr');
  const [item] = telemetry;
  assertNoNullish(item);
  assert.equal(item.schemaVersion, TELEMETRY_SCHEMA_VERSION);
  assert.equal(item.errorClass, undefined);
  assert.equal(item.errorCause, undefined);
  assert.equal(item.upstreamStatus, 200);
  assert.equal(item.upstreamRetried, false);
  assert.equal(typeof item.upstreamReused, 'boolean');
  assertIntMs(item, 'latencyMs', 'gatewayMs', 'upstreamMs', 'upstreamTtfbMs');
  assert.equal(item.gatewayMs, Math.max(0, item.latencyMs - item.upstreamMs));
  assert.ok(item.upstreamTtfbMs <= item.upstreamMs);
  // HTTP thuần không có secureConnect → không có số đo connect (chỉ có khi TLS socket mới).
  assert.equal(item.upstreamConnectMs, undefined);
});

test('GET lần hai dùng lại socket keep-alive: upstreamReused = true', async () => {
  await call('/ok');
  await call('/ok');
  assert.equal(telemetry[1].upstreamReused, true);
});

test('body nhị phân và body POST gửi đi giữ nguyên từng byte (base64 hai chiều)', async () => {
  const bin = await call('/binary');
  assert.equal(bin.isBase64Encoded, true);
  assert.ok(Buffer.from(bin.body, 'base64').equals(binary));
  const payload = randomBytes(2048);
  const echo = await call('/echo', { httpMethod: 'POST', isBase64Encoded: true, body: payload.toString('base64') });
  assert.ok(Buffer.from(echo.body, 'base64').equals(payload));
  assert.equal(telemetry[1].upstreamReused, false); // POST không dùng pool
});

test('backend 500: trả nguyên status/body, UPSTREAM_5XX, errorClass upstream_5xx, upstreamStatus 500', async () => {
  const result = await call('/fail');
  assert.equal(result.statusCode, 500);
  assert.equal(result.body, 'backend exploded');
  assert.equal(result.headers['X-Mrapi-Source'], 'upstream');
  const [item] = telemetry;
  assert.deepEqual([item.errorType, item.errorClass, item.upstreamStatus], ['UPSTREAM_5XX', 'upstream_5xx', 500]);
  assert.equal(item.errorCause, undefined);
  assertNoNullish(item);
});

test('timeout: 504, errorClass timeout, upstreamMs xấp xỉ timeoutMs, không có upstreamStatus', async () => {
  api.timeoutMs = 150;
  const result = await call('/slow');
  assert.equal(result.statusCode, 504);
  const [item] = telemetry;
  assert.deepEqual([item.errorType, item.errorClass], ['UPSTREAM_TIMEOUT', 'timeout']);
  assert.ok(item.upstreamMs >= 140 && item.upstreamMs < 1000, `upstreamMs=${item.upstreamMs}`);
  assert.equal(item.upstreamStatus, undefined);
  assert.equal(item.upstreamTtfbMs, undefined);
  assertNoNullish(item);
});

test('ECONNREFUSED: 502 connection_error, errorCause ECONNREFUSED', async () => {
  targetPort = closedPort;
  const result = await call('/ok');
  assert.equal(result.statusCode, 502);
  assert.equal(JSON.parse(result.body).code, 'UPSTREAM_UNREACHABLE');
  const [item] = telemetry;
  assert.deepEqual([item.errorClass, item.errorCause], ['connection_error', 'ECONNREFUSED']);
  assertIntMs(item, 'upstreamMs', 'gatewayMs');
  assertNoNullish(item);
});

test('backend trả quá lớn: status 502 nhưng upstreamStatus là status thật 200', async () => {
  const result = await call('/huge');
  assert.equal(result.statusCode, 502);
  assert.deepEqual([telemetry[0].errorType, telemetry[0].errorClass, telemetry[0].upstreamStatus], ['UPSTREAM_TOO_LARGE', 'upstream_5xx', 200]);
});

test('lỗi gateway trước khi gọi backend: không có trường upstream, gatewayMs = latencyMs', async () => {
  api.enabled = false;
  await call('/ok');
  const [item] = telemetry;
  assert.equal(item.errorClass, 'client_4xx');
  assert.equal(item.gatewayMs, item.latencyMs);
  for (const f of ['upstreamMs', 'upstreamReused', 'upstreamRetried', 'upstreamStatus', 'upstreamTtfbMs', 'upstreamConnectMs']) assert.equal(item[f], undefined, f);
  assertNoNullish(item);
});

test('không log API key, token, header hay body; mỗi request có một dòng PROXY_TELEMETRY_WRITE', async () => {
  await call('/ok');
  await call('/fail', { httpMethod: 'POST', body: '{"secretBody":"do-not-log"}' });
  targetPort = closedPort;
  await call('/ok');
  const text = logs.join('\n');
  for (const secret of [API_KEY, 'portal-session-token', 'do-not-log', '14.161.0.1']) assert.ok(!text.includes(secret), secret);
  const writes = logs.filter(l => l.includes('"PROXY_TELEMETRY_WRITE"')).map(l => JSON.parse(l));
  assert.equal(writes.length, 3);
  for (const w of writes) {
    assert.deepEqual(Object.keys(w).sort(), ['event', 'ok', 'requestId', 'writeMs']);
    assert.equal(w.ok, true);
    assert.ok(Number.isInteger(w.writeMs) && w.writeMs >= 0);
  }
  for (const item of telemetry) for (const v of Object.values(item)) assert.ok(!String(v).includes(API_KEY));
});

test('PutItem treo: response vẫn trả trong hạn TELEMETRY_WRITE_TIMEOUT_MS và log ok=false', async () => {
  db.send = command => {
    if (command.constructor.name === 'GetCommand') return Promise.resolve({ Item: structuredClone(api) });
    return new Promise(() => {}); // không bao giờ xong
  };
  const started = Date.now();
  const result = await call('/ok');
  const took = Date.now() - started;
  assert.equal(result.statusCode, 200);
  assert.equal(result.body, unicode);
  assert.ok(took < 1000, `took ${took} ms`);
  assert.ok(logs.some(l => l.includes('"TELEMETRY_WRITE_FAILED"') && l.includes('TelemetryWriteTimeout')));
  const write = JSON.parse(logs.find(l => l.includes('"PROXY_TELEMETRY_WRITE"')));
  assert.equal(write.ok, false);
  // Dữ liệu request vẫn còn trong dòng log PROXY_REQUEST.
  assert.ok(logs.some(l => l.includes('"PROXY_REQUEST"') && l.includes('"schemaVersion":2')));
});

test('PROXY_NO_AUTHORIZER: không chuyển tiếp, log có status/errorClass để đếm', async () => {
  const result = await call('/ok', { requestContext: { requestId: 'req-noauth' } });
  assert.equal(result.statusCode, 500);
  assert.equal(telemetry.length, 0);
  const line = JSON.parse(logs.find(l => l.includes('PROXY_NO_AUTHORIZER')));
  assert.deepEqual([line.status, line.errorClass, line.errorType, line.schemaVersion], [500, 'gateway', 'GATEWAY_INTERNAL', 2]);
});

// Mô phỏng socket để kiểm phần không dựng được bằng HTTP thuần: TLS secureConnect và gửi lại khi socket cũ hỏng.
function fakeTransport(plan) {
  let n = 0;
  transport.request = (url, options, onResponse) => {
    const step = plan[n++] ?? plan.at(-1);
    const req = new EventEmitter();
    req.destroy = () => {};
    req.reusedSocket = step.reused ?? false;
    req.end = () => setImmediate(() => {
      const socket = new EventEmitter();
      req.emit('socket', socket);
      setTimeout(() => {
        if (!step.reused) socket.emit('secureConnect');
        if (step.error) return req.emit('error', Object.assign(new Error(step.error), { code: step.error }));
        setTimeout(() => {
          const res = new PassThrough();
          Object.assign(res, { statusCode: 201, headers: {} });
          onResponse(res);
          res.end('ok');
        }, 5);
      }, 5);
    });
    return req;
  };
}

test('socket TLS mới: có upstreamConnectMs ≤ upstreamTtfbMs ≤ upstreamMs', async () => {
  fakeTransport([{}]);
  await call('/x');
  const [item] = telemetry;
  assertIntMs(item, 'upstreamConnectMs', 'upstreamTtfbMs', 'upstreamMs');
  assert.ok(item.upstreamConnectMs <= item.upstreamTtfbMs && item.upstreamTtfbMs <= item.upstreamMs);
  assert.equal(item.upstreamReused, false);
});

test('socket cũ hỏng rồi gửi lại (GET): upstreamRetried = true, connect đo trên lần gửi cuối', async () => {
  fakeTransport([{ reused: true, error: 'ECONNRESET' }, {}]);
  const result = await call('/x');
  assert.equal(result.statusCode, 201);
  const [item] = telemetry;
  assert.equal(item.upstreamRetried, true);
  assert.equal(item.upstreamReused, false);
  assert.ok(Number.isInteger(item.upstreamConnectMs));
});

test('socket dùng lại: không có upstreamConnectMs', async () => {
  fakeTransport([{ reused: true }]);
  await call('/x');
  assert.equal(telemetry[0].upstreamReused, true);
  assert.equal(telemetry[0].upstreamConnectMs, undefined);
});

test('errorClass ghi vào item luôn thuộc ERROR_CLASSES', () => {
  for (const item of telemetry) if (item.errorClass) assert.ok(ERROR_CLASSES.includes(item.errorClass));
});
