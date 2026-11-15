// Đo thời gian thu hồi key xuyên Region (Global Table mrapi-control, authorizer cache TTL 60 s:
// thời gian đo gồm cả thời gian kết quả cũ còn trong cache, tối đa ~60 s).
// Mỗi lượt: tạo key ở Region gốc → chờ Region kia trả 200 → DELETE /api/keys ở Region gốc →
// poll Region kia mỗi ~200 ms (tuần tự, tối đa 90 s) đến khi 401/403.
// Thời gian đo = lúc gửi request bị chặn đầu tiên − lúc DELETE trả 200 (cận trên);
// độ phân giải = khoảng giữa request còn được phép cuối cùng và request bị chặn đầu tiên.
//
// PROBE=disabled (mặc định): API đích bị tắt nên request được authorizer cho qua trả ngay 403 API_DISABLED
// từ proxy (body có "code"), không đi ra backend → mỗi lượt poll nhanh, độ phân giải tốt hơn.
// Request bị authorizer chặn trả 401/403 với body {"Message": ...} của API Gateway.
// PROBE=upstream: API bật, poll /status/204 qua httpbin (chậm hơn, độ phân giải ~0,5–0,8 s).
//
//   ROUNDS=3 node tests/e2e/revoke-cross-region.mjs
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const BASES = {
  SG: (process.env.SG_BASE || 'https://43vakggyh5.execute-api.ap-southeast-1.amazonaws.com/demo').replace(/\/$/, ''),
  TYO: (process.env.TYO_BASE || 'https://n39r5pits8.execute-api.ap-northeast-1.amazonaws.com/demo').replace(/\/$/, ''),
};
const backend = process.env.SAMPLE_BACKEND || 'https://httpbin.org';
const rounds = Number(process.env.ROUNDS || 3);
const probe = process.env.PROBE || 'disabled';
// Authorizer cho qua: backend trả 204 (upstream) hoặc proxy trả lỗi gateway có code (disabled).
const allowed = r => (probe === 'upstream' ? r.status === 204 : Boolean(r.data?.code));
const denied = r => (r.status === 401 || r.status === 403) && !r.data?.code;
const tag = process.env.E2E_TAG || `e2e-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`;
const vn = (ms = Date.now()) => new Date(ms).toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }) + '.' + String(ms % 1000).padStart(3, '0');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function call(base, method, path, { body, token, key } = {}) {
  const headers = { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(key ? { 'x-api-key': key } : {}) };
  const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}

const password = randomBytes(20).toString('hex');
const setup = async (origin) => {
  const base = BASES[origin];
  const s = await call(base, 'POST', '/api/signup', { body: { orgName: `${tag} revoke ${origin}`, email: `${tag}-revoke-${origin.toLowerCase()}-${Date.now()}@example.com`, password } });
  assert.equal(s.status, 201);
  // /status/204: backend trả nhanh, body rỗng.
  const api = await call(base, 'POST', '/api/apis', { token: s.data.token, body: { name: `${tag} revoke ${origin}`, baseUrl: backend, timeoutMs: 5000 } });
  assert.equal(api.status, 201);
  if (probe === 'disabled') assert.equal((await call(base, 'PATCH', `/api/apis/${api.data.api.apiId}`, { token: s.data.token, body: { enabled: false } })).status, 200);
  return { token: s.data.token, tenantId: s.data.tenantId, apiId: api.data.api.apiId };
};

const rows = [];
for (const [origin, target] of [['SG', 'TYO'], ['TYO', 'SG']]) {
  const t = await setup(origin);
  console.log(`# ${origin}→${target} tenant ${t.tenantId} api ${t.apiId}`);
  await sleep(3000); // để API sang Region kia
  for (let i = 1; i <= rounds; i++) {
    const k = await call(BASES[origin], 'POST', '/api/keys', { token: t.token, body: { name: `${tag} revoke ${origin} #${i}`, apiIds: [t.apiId] } });
    assert.equal(k.status, 201);
    const keyCreated = Date.now();
    const path = `/proxy/${t.apiId}/status/204`;
    // Chờ key dùng được ở Region đích (đo luôn độ trễ sao chép khi tạo).
    let usableAt;
    for (const end = Date.now() + 30000; Date.now() < end;) {
      const sentAt = Date.now();
      const r = await call(BASES[target], 'GET', path, { key: k.data.apiKey });
      if (allowed(r)) { usableAt = sentAt; break; }
      await sleep(200);
    }
    assert.ok(usableAt, 'key không dùng được ở Region đích sau 30 s');
    await sleep(500);
    const delStart = Date.now();
    const del = await call(BASES[origin], 'DELETE', `/api/keys/${k.data.key.keyId}`, { token: t.token });
    const delDone = Date.now();
    assert.equal(del.status, 200);
    let lastAllowed = delStart, deniedAt, deniedStatus, polls = 0;
    for (const end = delDone + 90000; Date.now() < end;) {
      const sentAt = Date.now(); polls++;
      const r = await call(BASES[target], 'GET', path, { key: k.data.apiKey });
      if (denied(r)) { deniedAt = sentAt; deniedStatus = r.status; break; }
      if (!allowed(r)) throw new Error(`phản hồi lạ ${r.status} ${JSON.stringify(r.data).slice(0, 100)}`);
      lastAllowed = sentAt;
      await sleep(Math.max(0, 200 - (Date.now() - sentAt)));
    }
    const row = {
      direction: `${origin}→${target}`, round: i, keyId: k.data.key.keyId,
      createToUsableMs: usableAt - keyCreated,
      revokeSentVN: vn(delStart), revokeOkVN: vn(delDone), deniedVN: deniedAt ? vn(deniedAt) : null,
      revokeMs: deniedAt ? deniedAt - delDone : null, resolutionMs: deniedAt ? deniedAt - lastAllowed : null,
      polls, probe, deniedStatus: deniedStatus ?? 'TIMEOUT',
    };
    rows.push(row); console.log(JSON.stringify(row));
    await sleep(1000);
  }
  await call(BASES[origin], 'POST', '/api/logout', { token: t.token });
}
const stats = arr => { const s = [...arr].sort((a, b) => a - b); const m = s.length;
  return { n: m, min: s[0], max: s[m - 1], median: m % 2 ? s[(m - 1) / 2] : (s[m / 2 - 1] + s[m / 2]) / 2 }; };
for (const dir of ['SG→TYO', 'TYO→SG']) {
  const ok = rows.filter(r => r.direction === dir && r.revokeMs !== null);
  console.log(`STATS ${dir} revokeMs ${JSON.stringify(stats(ok.map(r => r.revokeMs)))} createToUsableMs ${JSON.stringify(stats(ok.map(r => r.createToUsableMs)))}`);
}
if (rows.some(r => r.revokeMs === null)) process.exitCode = 1;
