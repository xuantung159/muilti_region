// Các ca nghiệm thu bổ sung cho proxy.mjs (chạy trên AWS thật, tuần tự, tạo dữ liệu thử có tiền tố E2E_TAG):
//   - hai tenant đều gọi được API của mình (2xx) và không chạm được key/API của nhau qua portal;
//   - key không tồn tại / sai định dạng → 401; key đã thu hồi → 403 ở cả hai Region;
//   - backend không phân giải được → 502 UPSTREAM_UNREACHABLE;
//   - /api/usage (đọc mrapi-telemetry) đếm đúng số request đã gửi, theo Region và theo key,
//     request bị authorizer chặn không được đếm.
//
//   SG_BASE=... TYO_BASE=... node tests/e2e/acceptance-extra.mjs
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const SG = (process.env.SG_BASE || 'https://43vakggyh5.execute-api.ap-southeast-1.amazonaws.com/demo').replace(/\/$/, '');
const TYO = (process.env.TYO_BASE || 'https://n39r5pits8.execute-api.ap-northeast-1.amazonaws.com/demo').replace(/\/$/, '');
const backend = process.env.SAMPLE_BACKEND || 'https://httpbin.org';
const tag = process.env.E2E_TAG || `e2e-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`;
const vn = (d = new Date()) => d.toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function call(base, method, path, { body, token, key } = {}) {
  const headers = { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(key ? { 'x-api-key': key } : {}) };
  const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, source: r.headers.get('x-mrapi-source'), region: r.headers.get('x-served-region'), requestId: r.headers.get('x-request-id'), data };
}
const results = [];
async function check(id, name, fn) {
  try { const note = await fn(); results.push(['PASS', id, name, note ?? '']); }
  catch (err) { results.push(['FAIL', id, name, err.message]); }
}
// Chờ Global Tables sao chép bản ghi sang Region kia (thường ~1 giây).
async function until(fn, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('hết thời gian chờ'); await sleep(300); }
}

console.log(`start ${vn()} tag=${tag}`);
const password = randomBytes(20).toString('hex');
const signup = async org => {
  const r = await call(SG, 'POST', '/api/signup', { body: { orgName: `${tag} extra ${org}`, email: `${tag}-extra-${org}-${Date.now()}@example.com`, password } });
  assert.equal(r.status, 201); return r.data;
};
const A = await signup('a'); const B = await signup('b');
const newApi = async (tok, name, baseUrl = backend, timeoutMs = 5000) => {
  const r = await call(SG, 'POST', '/api/apis', { token: tok, body: { name: `${tag} ${name}`, baseUrl, timeoutMs } });
  assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data.api.apiId;
};
const newKey = async (tok, apiIds, name = 'extra') => {
  const r = await call(SG, 'POST', '/api/keys', { token: tok, body: { name: `${tag} ${name}`, apiIds } });
  assert.equal(r.status, 201); return r.data;
};
const apiA = await newApi(A.token, 'extra A');
const apiDead = await newApi(A.token, 'extra unreachable', `https://${tag}-nxdomain.multi-region.io.vn`);
const apiB = await newApi(B.token, 'extra B');
const keyA = await newKey(A.token, [apiA, apiDead], 'extra A');
const keyB = await newKey(B.token, [apiB], 'extra B');
console.log(`tenantA=${A.tenantId} keyA=${keyA.key.keyId} tenantB=${B.tenantId} keyB=${keyB.key.keyId}`);

// Đợi key/API sang Tokyo trước khi đếm. Chờ 3 giây trước để không có request 404 API_NOT_FOUND
// (key đã sang nhưng API chưa sang) lọt vào telemetry làm lệch số đếm.
await sleep(3000);
await until(async () => (await call(TYO, 'GET', `/proxy/${apiA}/get`, { key: keyA.apiKey })).status === 200);
await until(async () => (await call(TYO, 'GET', `/proxy/${apiB}/get`, { key: keyB.apiKey })).status === 200);
// Hai request chờ ở trên đã vào telemetry (1 cho A ở Tokyo, 1 cho B ở Tokyo). Ghi nhận để đếm.
const sent = { A: { 'ap-southeast-1': 0, 'ap-northeast-1': 1, errors: 0 }, B: { 'ap-southeast-1': 0, 'ap-northeast-1': 1, errors: 0 } };

await check('X1', 'hai tenant đều gọi được API của mình ở cả hai Region (2xx)', async () => {
  for (const [base, region] of [[SG, 'ap-southeast-1'], [TYO, 'ap-northeast-1']]) {
    const a = await call(base, 'GET', `/proxy/${apiA}/get?who=a`, { key: keyA.apiKey });
    const b = await call(base, 'GET', `/proxy/${apiB}/get?who=b`, { key: keyB.apiKey });
    assert.equal(a.status, 200); assert.equal(b.status, 200);
    assert.equal(a.region, region); assert.equal(b.region, region);
    sent.A[region]++; sent.B[region]++;
  }
});
await check('X2', 'tenant B không xem/thu hồi được key và API của tenant A qua portal', async () => {
  const keys = await call(SG, 'GET', '/api/keys', { token: B.token });
  assert.ok(!keys.data.keys.some(k => k.keyId === keyA.key.keyId), 'B thấy key của A');
  assert.equal((await call(SG, 'DELETE', `/api/keys/${keyA.key.keyId}`, { token: B.token })).status, 404);
  assert.equal((await call(SG, 'GET', `/api/apis/${apiA}`, { token: B.token })).status, 404);
  const apisB = await call(SG, 'GET', '/api/apis', { token: B.token });
  assert.ok(!apisB.data.apis.some(a => a.apiId === apiA), 'B thấy API của A');
  const still = await call(SG, 'GET', `/proxy/${apiA}/get`, { key: keyA.apiKey });
  assert.equal(still.status, 200, 'key A bị ảnh hưởng sau thao tác của B'); sent.A['ap-southeast-1']++;
});
await check('X3', 'key đúng định dạng nhưng không tồn tại, key sai định dạng, Bearer thay x-api-key → 401 (không vào telemetry)', async () => {
  const fake = `mrk_${A.tenantId}_${'0'.repeat(12)}_${'a'.repeat(48)}`;
  for (const base of [SG, TYO]) {
    assert.equal((await call(base, 'GET', `/proxy/${apiA}/get`, { key: fake })).status, 401);
    assert.equal((await call(base, 'GET', `/proxy/${apiA}/get`, { key: 'abc' })).status, 401);
    assert.equal((await call(base, 'GET', `/proxy/${apiA}/get`, { token: 'f'.repeat(64) })).status, 401);
  }
});
await check('X4', 'key tenant A gọi API tenant B ở Tokyo → 403 (không vào telemetry)', async () => {
  assert.equal((await call(TYO, 'GET', `/proxy/${apiB}/get`, { key: keyA.apiKey })).status, 403);
});
await check('X5', 'backend không phân giải được → 502 UPSTREAM_UNREACHABLE, source=gateway', async () => {
  const r = await call(SG, 'GET', `/proxy/${apiDead}/x`, { key: keyA.apiKey });
  assert.equal(r.status, 502); assert.equal(r.data.code, 'UPSTREAM_UNREACHABLE'); assert.equal(r.source, 'gateway');
  sent.A['ap-southeast-1']++; sent.A.errors++;
  return `requestId ${r.requestId}`;
});
await check('X6', 'backend 4xx/5xx được đếm là lỗi trong usage', async () => {
  const r = await call(TYO, 'GET', `/proxy/${apiA}/status/503`, { key: keyA.apiKey });
  assert.equal(r.status, 503); assert.equal(r.source, 'upstream');
  sent.A['ap-northeast-1']++; sent.A.errors++;
  const n = await call(SG, 'GET', `/proxy/${apiB}/status/404`, { key: keyB.apiKey });
  assert.equal(n.status, 404); sent.B['ap-southeast-1']++; sent.B.errors++;
});

// Usage: đọc ở cả hai Region (telemetry là Global Table), so với số request đã gửi.
const expect = s => ({ total: s['ap-southeast-1'] + s['ap-northeast-1'], ...s });
const usageMatches = async (base, tenant, s) => {
  const u = await call(base, 'GET', '/api/usage?range=1h', { token: tenant.token });
  if (u.status !== 200) return null;
  const e = expect(s);
  const ok = u.data.totals.requests === e.total && u.data.totals.errors === s.errors &&
    (u.data.byRegion['ap-southeast-1']?.requests ?? 0) === s['ap-southeast-1'] &&
    (u.data.byRegion['ap-northeast-1']?.requests ?? 0) === s['ap-northeast-1'];
  return ok ? u.data : (until.last = u.data, null);
};
for (const [label, tenant, s, key] of [['A', A, sent.A, keyA], ['B', B, sent.B, keyB]]) {
  for (const [base, rn] of [[SG, 'SG'], [TYO, 'Tokyo']]) {
    await check('X7', `usage tenant ${label} đọc ở ${rn} khớp số request đã gửi (tổng ${expect(s).total}, lỗi ${s.errors}, SG ${s['ap-southeast-1']}, Tokyo ${s['ap-northeast-1']})`, async () => {
      try {
        const d = await until(() => usageMatches(base, tenant, s), 20000);
        assert.equal(d.byKey[key.key.keyId]?.requests, expect(s).total);
        return `totals=${JSON.stringify({ requests: d.totals.requests, errors: d.totals.errors })}`;
      } catch (err) {
        throw new Error(`${err.message}; thực tế ${JSON.stringify(until.last?.totals)} byRegion=${JSON.stringify(until.last?.byRegion)}`);
      }
    });
  }
}

await check('X8', 'key thu hồi ở SG → 403 ở SG và (sau khi đồng bộ) ở Tokyo; body khi bị chặn', async () => {
  assert.equal((await call(SG, 'DELETE', `/api/keys/${keyB.key.keyId}`, { token: B.token })).status, 200);
  const sg = await call(SG, 'GET', `/proxy/${apiB}/get`, { key: keyB.apiKey });
  assert.equal(sg.status, 403);
  await until(async () => (await call(TYO, 'GET', `/proxy/${apiB}/get`, { key: keyB.apiKey })).status === 403);
  return `body SG: ${JSON.stringify(sg.data).slice(0, 120)}`;
});

for (const t of [A, B]) await call(SG, 'POST', '/api/logout', { token: t.token });
console.log(`end ${vn()}`);
for (const [r, id, name, note] of results) console.log(`${r} ${id} ${name}${note ? ` — ${note}` : ''}`);
if (results.some(([r]) => r === 'FAIL')) process.exitCode = 1;
