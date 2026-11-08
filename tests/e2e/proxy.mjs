// E2E proxy trên AWS thật (nghiệm thu D2–D7). Cần API Gateway đã có route /proxy/{apiId}/{proxy+}
// gắn REQUEST authorizer (cache TTL 0 khi chạy test thu hồi key) và Lambda proxy.
//
//   npm run test:e2e:proxy --prefix src
//   API_BASE_URL=https://.../demo SAMPLE_BACKEND=https://httpbin.org npm run test:e2e:proxy --prefix src
//
// Backend mẫu mặc định là httpbin.org (công khai): /anything trả lại request nhận được,
// /status/500 trả lỗi, /delay/5 phản hồi chậm 5 giây. Script tạo tài khoản và key thử thật.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const config = JSON.parse(await readFile(new URL('../../config/demo/ap-southeast-1.json', import.meta.url), 'utf8'));
const base = (process.env.API_BASE_URL || config.apiGateway.baseUrl).replace(/\/$/, '');
const backend = process.env.SAMPLE_BACKEND || 'https://httpbin.org';
if (!base) throw new Error('Điền API baseUrl hoặc API_BASE_URL trước khi chạy.');

async function call(method, path, { body, token, key, raw } = {}) {
  const headers = { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(key ? { 'x-api-key': key } : {}) };
  const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : raw ? body : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, source: r.headers.get('x-mrapi-source'), requestId: r.headers.get('x-request-id'), data };
}
const results = [];
async function check(id, name, fn) {
  try { await fn(); results.push(['PASS', id, name]); }
  catch (err) { results.push(['FAIL', id, `${name}: ${err.message}`]); }
}

const tag = process.env.E2E_TAG || `e2e-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`;
const password = randomBytes(20).toString('hex');
const signup = async org => (await call('POST', '/api/signup', { body: { orgName: `${tag} proxy ${org}`, email: `${tag}-proxy-${org}-${Date.now()}@example.com`, password } })).data.token;
const a = await signup('a'); const b = await signup('b');
assert.ok(a && b, 'Không tạo được tài khoản thử; kiểm tra portal API trước.');
const newApi = async (token, name, timeoutMs = 5000) =>
  (await call('POST', '/api/apis', { token, body: { name: `${tag} ${name}`, baseUrl: backend, timeoutMs } })).data.api.apiId;
const newKey = async (token, apiIds) => (await call('POST', '/api/keys', { token, body: { name: `${tag} key`, apiIds } })).data;
const api1 = await newApi(a, 'E2E main', 2000);
const api2 = await newApi(a, 'E2E outside scope');
const apiB = await newApi(b, 'E2E tenant B');
const keyA = await newKey(a, [api1]);
const keyB = await newKey(b, [apiB]);

await check('D2', 'method/path/query/body tới backend, không lộ key gateway', async () => {
  const r = await call('POST', `/proxy/${api1}/anything/orders?x=1&x=2`, { key: keyA.apiKey, body: { n: 1 } });
  assert.equal(r.status, 200); assert.equal(r.source, 'upstream');
  assert.equal(r.data.method, 'POST');
  assert.match(r.data.url, /\/anything\/orders\?x=1&x=2$/);
  assert.deepEqual(r.data.json, { n: 1 });
  const sentHeaders = Object.keys(r.data.headers).map(h => h.toLowerCase());
  assert.ok(!sentHeaders.includes('x-api-key'), 'backend nhận được x-api-key');
  console.log(`  requestId mẫu để đối chiếu telemetry/log: ${r.requestId}`);
});
await check('D3', 'thiếu key / key sai → 401', async () => {
  assert.equal((await call('GET', `/proxy/${api1}/get`)).status, 401);
  assert.equal((await call('GET', `/proxy/${api1}/get`, { key: keyA.apiKey.replace(/.$/, c => (c === '0' ? '1' : '0')) })).status, 401);
});
await check('D4', 'key gọi API ngoài scope hoặc của tenant khác → 403', async () => {
  assert.equal((await call('GET', `/proxy/${api2}/get`, { key: keyA.apiKey })).status, 403);
  assert.equal((await call('GET', `/proxy/${api1}/get`, { key: keyB.apiKey })).status, 403);
});
await check('D5', 'backend 5xx trả nguyên trạng, backend chậm → 504, API tắt → 403', async () => {
  const err = await call('GET', `/proxy/${api1}/status/500`, { key: keyA.apiKey });
  assert.equal(err.status, 500); assert.equal(err.source, 'upstream');
  const slow = await call('GET', `/proxy/${api1}/delay/5`, { key: keyA.apiKey });
  assert.equal(slow.status, 504); assert.equal(slow.data.code, 'UPSTREAM_TIMEOUT');
  await call('PATCH', `/api/apis/${api1}`, { token: a, body: { enabled: false } });
  const off = await call('GET', `/proxy/${api1}/get`, { key: keyA.apiKey });
  assert.equal(off.status, 403); assert.equal(off.data.code, 'API_DISABLED');
  await call('PATCH', `/api/apis/${api1}`, { token: a, body: { enabled: true } });
});
await check('D6', 'đích nội bộ bị từ chối khi đăng ký', async () => {
  for (const baseUrl of ['https://127.0.0.1', 'https://169.254.169.254', 'https://localhost', 'http://backend.company.com']) {
    assert.equal((await call('POST', '/api/apis', { token: a, body: { name: 'bad', baseUrl } })).status, 400, baseUrl);
  }
});
await check('D3', 'key đã thu hồi → 403 (cần authorizer cache TTL 0)', async () => {
  await call('DELETE', `/api/keys/${keyA.key.keyId}`, { token: a });
  assert.equal((await call('GET', `/proxy/${api1}/get`, { key: keyA.apiKey })).status, 403);
});

for (const token of [a, b]) await call('POST', '/api/logout', { token });
for (const [result, id, name] of results) console.log(`${result} ${id} ${name}`);
console.log('D7: kiểm tra bảng mrapi-telemetry có các requestId ở trên (PK TENANT#<tenant>), lỗi có GSI1PK. Dữ liệu thử vẫn còn trong control.');
if (results.some(([result]) => result === 'FAIL')) process.exitCode = 1;
