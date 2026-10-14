import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const config = JSON.parse(await readFile(new URL('../../config/demo/ap-southeast-1.json', import.meta.url), 'utf8'));
const base = (process.env.API_BASE_URL || config.apiGateway.baseUrl).replace(/\/$/, '');
if (!base) throw new Error('Điền API baseUrl hoặc API_BASE_URL trước khi chạy.');
async function call(method, path, body, token) {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  return { status: r.status, data: await r.json() };
}
const password = randomBytes(20).toString('hex');
const email = `control-${Date.now()}@example.com`;
const x = await call('POST', '/api/signup', { orgName: 'Control X', email, password }); assert.equal(x.status, 201);
assert.equal((await call('POST', '/api/signup', { orgName: 'Duplicate', email, password })).status, 409);
const login = await call('POST', '/api/login', { email, password }); assert.equal(login.status, 200);
const y = await call('POST', '/api/signup', { orgName: 'Control Y', email: `other-${Date.now()}@example.com`, password }); assert.equal(y.status, 201);
const api = await call('POST', '/api/apis', { name: 'Control test', baseUrl: 'https://backend.company.com', timeoutMs: 5000 }, login.data.token); assert.equal(api.status, 201);
const path = `/api/apis/${api.data.api.apiId}`;
assert.equal((await call('GET', path, undefined, y.data.token)).status, 404);
assert.equal((await call('PATCH', path, { enabled: false }, y.data.token)).status, 404);
assert.equal((await call('PATCH', path, { enabled: false, name: 'Control updated' }, login.data.token)).status, 200);
assert.equal((await call('GET', path, undefined, login.data.token)).data.api.enabled, false);
assert.equal((await call('POST', '/api/apis', { name: 'Bad', baseUrl: 'http://127.0.0.1' }, login.data.token)).status, 400);
for (const token of [x.data.token, login.data.token, y.data.token]) {
  assert.equal((await call('POST', '/api/logout', {}, token)).status, 200);
  assert.equal((await call('GET', '/api/me', undefined, token)).status, 401);
}
console.log('PASS control plane: tài khoản, API config, tenant isolation, logout. Dữ liệu thử vẫn còn trong control; API đã tắt.');
