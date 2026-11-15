// Demo failover trên web: người đã đăng nhập tự bấm giả lập "một Region gặp lỗi",
// rồi xem Route 53 chuyển request sang Region còn lại và tự quay về khi hết hạn.
//
// Cơ chế: ghi bản ghi HEALTH/SIMULATED_OUTAGE (src/shared/outage.mjs) vào bảng control.
// Lambda api ở Region bị chọn đọc bản ghi đó và cho /health trả 503, health check Route 53
// chuyển Unhealthy, Route 53 ngừng trả Region đó. /proxy không bị chặn: chỉ có định tuyến DNS thay đổi.
//
// Route: GET/POST/DELETE /api/demo/failover (nối trong index.mjs).
import { Resolver, lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { GetHealthCheckStatusCommand, Route53Client, TestDNSAnswerCommand } from '@aws-sdk/client-route-53';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { CONTROL_TABLE, REGION, db as defaultDb, json, parseBody } from '../shared/lib.mjs';
import { OUTAGE_KEY, OUTAGE_REGIONS, outageActive } from '../shared/outage.mjs';

export const API_HOST = 'api.multi-region.io.vn';
const HOSTED_ZONE_ID = 'Z03093462BF2L4GV4FGRD';
// Trùng với HEALTH_CHECK_IDS trong index.mjs (health check gắn hai bản ghi latency của API_HOST).
const HEALTH_CHECK_IDS = {
  'ap-southeast-1': 'c7764d38-b17d-44df-8d44-4f2791296adc',
  'ap-northeast-1': 'bfa2df95-4abf-40d2-a240-dbd04acf735c',
};
export const REGION_NAMES = { 'ap-southeast-1': 'Singapore', 'ap-northeast-1': 'Tokyo' };

// IP resolver đại diện để hỏi Route 53 "trả gì cho người dùng ở nước này" (TestDNSAnswer).
// Lấy từ docs/runbooks/test-geo-routing.md; "expected" chỉ là dự kiến khi cả hai Region khỏe.
export const RESOLVERS = [
  { id: 'vn', label: 'Việt Nam (DNS Viettel)', ip: '203.113.131.1', expected: 'ap-southeast-1' },
  // Đo thật 11/11/2026: Route 53 trả Tokyo cho resolver Frankfurt (runbook 10/11 ghi Singapore).
  { id: 'de', label: 'Đức (Frankfurt)', ip: '3.78.206.104', expected: 'ap-northeast-1' },
  { id: 'kr', label: 'Hàn Quốc (Seoul)', ip: '43.202.71.241', expected: 'ap-northeast-1' },
  { id: 'us', label: 'Mỹ (Virginia)', ip: '98.88.15.13', expected: 'ap-northeast-1' },
];

export const LIMITS = {
  defaultMinutes: 5,
  minMinutes: 3, // ngắn hơn ~3 phút thì Route 53 chưa kịp chuyển, demo không thấy gì
  maxMinutes: 10,
  cooldownMinutes: 3, // chờ Route 53 quay về hẳn trước khi cho giả lập lần sau
  dailyPerTenant: 5,
};

// Mốc dự kiến, theo cấu hình health check (30 s × 3 lần) và số đo trong docs/reports/failover.md.
export const TIMELINE = [
  { key: 'start', label: 'Bật giả lập: /health ở Region bị chọn trả 503', fromSeconds: 0, toSeconds: 0, after: 'start' },
  { key: 'unhealthy', label: 'Route 53 health check chuyển Unhealthy (3 lần lỗi liên tiếp, chu kỳ 30 s)', fromSeconds: 60, toSeconds: 90, after: 'start' },
  { key: 'dns', label: 'Route 53 trả Region còn lại; client chuyển sau khi cache DNS (TTL 60 s) hết hạn', fromSeconds: 120, toSeconds: 180, after: 'start' },
  { key: 'end', label: 'Hết hạn hoặc kết thúc sớm: /health trả 200 trở lại', fromSeconds: 0, toSeconds: 0, after: 'end' },
  { key: 'healthy', label: 'Health check Healthy lại', fromSeconds: 30, toSeconds: 90, after: 'end' },
  { key: 'back', label: 'Route 53 trả lại Region gần nhất như trước sự cố', fromSeconds: 90, toSeconds: 150, after: 'end' },
];

const OBSERVE_CACHE_MS = 8000; // Route 53 API giới hạn 5 request/giây cho cả tài khoản
const IP_CACHE_MS = 10 * 60_000;
const OBSERVE_BUDGET_MS = 5000;

// ---------- Quan sát thật: health check, DNS, request ----------

const defaultRoute53 = new Route53Client({ region: 'us-east-1', maxAttempts: 3 });

async function freshResolve4(host) {
  // Resolver riêng mỗi lần: không dùng cache getaddrinfo của tiến trình Lambda.
  try {
    const resolver = new Resolver({ timeout: 2000, tries: 1 });
    return await resolver.resolve4(host);
  } catch {
    // Máy không cấu hình được c-ares (vd. chạy thử trên Windows): dùng resolver hệ điều hành.
    return (await lookup(host, { all: true, family: 4 })).map((a) => a.address);
  }
}

// GET https://api.multi-region.io.vn/health tới đúng một IP, đọc X-Served-Region.
function fetchHealth(ip) {
  return new Promise((resolve) => {
    const started = Date.now();
    const req = httpsRequest(`https://${API_HOST}/health`, {
      agent: false, // không giữ kết nối cũ sang Region cũ
      timeout: 2500,
      headers: { 'Cache-Control': 'no-cache' },
      lookup: (_host, options, callback) => (options?.all ? callback(null, [{ address: ip, family: 4 }]) : callback(null, ip, 4)),
    }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, servedRegion: res.headers['x-served-region'] ?? null, latencyMs: Date.now() - started }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (err) => resolve({ status: null, servedRegion: null, latencyMs: Date.now() - started, error: err.message === 'timeout' ? 'Hết thời gian chờ' : 'Không kết nối được' }));
    req.end();
  });
}

const ipRegions = new Map(); // ip -> { region, at }

// IP API Gateway của Region nào: hỏi thẳng IP đó /health và đọc X-Served-Region (kể cả khi 503).
async function regionOfIp(ip, deps) {
  const cached = ipRegions.get(ip);
  if (cached && Date.now() - cached.at < IP_CACHE_MS) return cached.region;
  const { servedRegion } = await deps.fetchHealth(ip);
  if (servedRegion) ipRegions.set(ip, { region: servedRegion, at: Date.now() });
  return servedRegion ?? null;
}

async function healthChecks(deps) {
  return Promise.all(Object.entries(HEALTH_CHECK_IDS).map(async ([region, HealthCheckId]) => {
    try {
      const { HealthCheckObservations: observations = [] } = await deps.route53.send(
        new GetHealthCheckStatusCommand({ HealthCheckId }), { abortSignal: AbortSignal.timeout(2500) });
      const ok = observations.filter((o) => o.StatusReport?.Status?.startsWith('Success')).length;
      // Route 53 coi endpoint là khoẻ khi hơn 18% điểm kiểm tra báo thành công.
      const status = !observations.length ? 'unknown' : ok / observations.length > 0.18 ? 'healthy' : 'unhealthy';
      return { region, status, okCheckers: ok, totalCheckers: observations.length };
    } catch (err) {
      console.error('demo-failover: GetHealthCheckStatus failed', region, err.name);
      return { region, status: 'unknown', okCheckers: 0, totalCheckers: 0, error: 'Không đọc được health check' };
    }
  }));
}

async function dnsAnswer(r, deps, deadline) {
  const base = { id: r.id, label: r.label, resolverIp: r.ip, expectedRegion: r.expected };
  const budget = Math.min(2500, deadline - Date.now());
  if (budget < 300) return { ...base, answerIps: [], answeredRegion: null, error: 'Hết thời gian chờ' };
  try {
    const res = await deps.route53.send(new TestDNSAnswerCommand({
      HostedZoneId: HOSTED_ZONE_ID, RecordName: API_HOST, RecordType: 'A', ResolverIP: r.ip,
    }), { abortSignal: AbortSignal.timeout(budget) });
    const answerIps = res.RecordData ?? [];
    const answeredRegion = answerIps.length ? await regionOfIp(answerIps[0], deps) : null;
    return { ...base, answerIps, answeredRegion };
  } catch (err) {
    console.error('demo-failover: TestDNSAnswer failed', r.id, err.name);
    return { ...base, answerIps: [], answeredRegion: null, error: 'Không hỏi được Route 53' };
  }
}

// Từng cặp một: cùng 2 lệnh GetHealthCheckStatus chạy song song là 4 lệnh, dưới giới hạn
// 5 request/giây của Route 53 API. Có hạn chót để cả lượt GET nằm trong timeout 10 s của Lambda.
async function dnsAnswers(deps, deadline) {
  const results = [];
  for (let i = 0; i < deps.resolvers.length; i += 2) {
    results.push(...await Promise.all(deps.resolvers.slice(i, i + 2).map((r) => dnsAnswer(r, deps, deadline))));
  }
  return results;
}

async function realRequest(deps) {
  try {
    const ips = await deps.resolve4(API_HOST);
    if (!ips.length) return { from: REGION ?? null, ip: null, status: null, servedRegion: null, latencyMs: null, error: 'DNS không trả địa chỉ' };
    const result = await deps.fetchHealth(ips[0]);
    if (result.servedRegion) ipRegions.set(ips[0], { region: result.servedRegion, at: Date.now() });
    return { from: REGION ?? null, ip: ips[0], ...result };
  } catch {
    return { from: REGION ?? null, ip: null, status: null, servedRegion: null, latencyMs: null, error: 'Không phân giải được tên miền' };
  }
}

let observeCache = null; // { at, value }

async function observe(deps, now) {
  if (observeCache && now - observeCache.at < OBSERVE_CACHE_MS) return observeCache.value;
  const deadline = Date.now() + OBSERVE_BUDGET_MS;
  const [checks, probe, dns] = await Promise.all([healthChecks(deps), realRequest(deps), dnsAnswers(deps, deadline)]);
  const value = { healthChecks: checks, dns, probe, observedAt: new Date(now).toISOString() };
  observeCache = { at: now, value };
  return value;
}

// Chỉ dùng cho test.
export function resetDemoFailoverCache() {
  observeCache = null;
  ipRegions.clear();
}

// ---------- Trạng thái giả lập ----------

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
const secondsLeft = (ms, now) => Math.max(0, Math.ceil((ms - now) / 1000));
const dayOf = (now) => new Date(now).toISOString().slice(0, 10);
const quotaKey = (tenantId, now) => ({ PK: `TENANT#${tenantId}`, SK: `DEMO_FAILOVER#${dayOf(now)}` });

async function readOutage(deps) {
  const { Item } = await deps.db.send(new GetCommand({ TableName: CONTROL_TABLE, Key: OUTAGE_KEY, ConsistentRead: true }));
  return Item ?? null;
}

async function readQuota(deps, session, now) {
  const { Item } = await deps.db.send(new GetCommand({ TableName: CONTROL_TABLE, Key: quotaKey(session.tenantId, now), ConsistentRead: true }));
  return Item?.count ?? 0;
}

function describeOutage(item, session, now) {
  if (!item) return { outage: null, cooldown: null, lastOutage: null };
  const active = outageActive(item, item.region, now);
  const summary = {
    region: item.region,
    regionName: REGION_NAMES[item.region] ?? item.region,
    startedAt: iso(item.startedAt),
    until: iso(item.until),
    endedEarlyAt: iso(item.endedEarlyAt),
    startedByMe: item.startedBy === session.tenantId,
  };
  return {
    outage: active ? { ...summary, remainingSeconds: secondsLeft(item.until, now) } : null,
    cooldown: !active && item.cooldownUntil > now ? { until: iso(item.cooldownUntil), remainingSeconds: secondsLeft(item.cooldownUntil, now) } : null,
    lastOutage: active ? null : summary,
  };
}

// Giai đoạn để giao diện diễn giải, suy ra từ dữ liệu thật (không phải kịch bản dựng sẵn).
function phaseOf(state, observed) {
  const target = state.outage?.region ?? state.lastOutage?.region;
  const other = OUTAGE_REGIONS.find((r) => r !== target);
  const targetHealth = observed.healthChecks.find((c) => c.region === target)?.status;
  const answered = observed.dns.map((d) => d.answeredRegion).filter(Boolean);
  const allToOther = answered.length > 0 && answered.every((r) => r === other);
  if (state.outage) {
    if (targetHealth !== 'unhealthy') return 'waiting_unhealthy';
    return allToOther ? 'failed_over' : 'waiting_dns';
  }
  if (state.lastOutage && (targetHealth === 'unhealthy' || allToOther)) return 'recovering';
  if (state.cooldown) return 'cooldown';
  return 'idle';
}

async function status(session, deps, now) {
  const [item, used, observed] = await Promise.all([readOutage(deps), readQuota(deps, session, now), observe(deps, now)]);
  const state = describeOutage(item, session, now);
  const unlimited = session.role === 'admin';
  let blockedReason = null;
  if (state.outage) blockedReason = `Đang giả lập sự cố ở ${state.outage.regionName}. Mỗi lúc chỉ một sự cố.`;
  else if (state.cooldown) blockedReason = `Hệ thống đang hồi phục sau lần giả lập trước, thử lại sau ${state.cooldown.remainingSeconds} giây.`;
  else if (!unlimited && used >= LIMITS.dailyPerTenant) blockedReason = `Mỗi tài khoản tối đa ${LIMITS.dailyPerTenant} lần giả lập mỗi ngày (UTC).`;
  return {
    now: iso(now),
    ...state,
    phase: phaseOf(state, observed),
    canStart: !blockedReason,
    blockedReason,
    quota: { used, max: unlimited ? null : LIMITS.dailyPerTenant },
    limits: LIMITS,
    ...observed,
    timeline: TIMELINE,
  };
}

async function start(session, event, deps, now) {
  const body = parseBody(event);
  const region = body.region;
  if (!OUTAGE_REGIONS.includes(region)) return json(400, { error: 'region phải là ap-southeast-1 hoặc ap-northeast-1' });
  const minutes = body.minutes === undefined ? LIMITS.defaultMinutes : body.minutes;
  if (!Number.isInteger(minutes) || minutes < LIMITS.minMinutes || minutes > LIMITS.maxMinutes) {
    return json(400, { error: `Thời lượng từ ${LIMITS.minMinutes} đến ${LIMITS.maxMinutes} phút` });
  }

  const current = describeOutage(await readOutage(deps), session, now);
  if (current.outage) return json(409, { error: `Đang giả lập sự cố ở ${current.outage.regionName}. Mỗi lúc chỉ một sự cố.` });
  if (current.cooldown) return json(409, { error: `Hệ thống đang hồi phục sau lần giả lập trước, thử lại sau ${current.cooldown.remainingSeconds} giây.` });

  // Không bao giờ để cả hai Region cùng lỗi: Region còn lại phải đang Healthy theo chính Route 53.
  const other = OUTAGE_REGIONS.find((r) => r !== region);
  const otherCheck = (await healthChecks(deps)).find((c) => c.region === other);
  if (otherCheck?.status !== 'healthy') {
    return json(409, { error: `Region còn lại (${REGION_NAMES[other]}) chưa Healthy nên không giả lập lỗi ${REGION_NAMES[region]}.` });
  }

  // Hạn mức theo tài khoản: đọc rồi ghi có điều kiện (không cần quyền UpdateItem).
  if (session.role !== 'admin') {
    const used = await readQuota(deps, session, now);
    if (used >= LIMITS.dailyPerTenant) return json(429, { error: `Mỗi tài khoản tối đa ${LIMITS.dailyPerTenant} lần giả lập mỗi ngày (UTC).` });
    try {
      await deps.db.send(new PutCommand({
        TableName: CONTROL_TABLE,
        Item: { ...quotaKey(session.tenantId, now), count: used + 1, expiresAt: Math.floor(now / 1000) + 2 * 86400 },
        ConditionExpression: 'attribute_not_exists(PK) OR #count = :used',
        ExpressionAttributeNames: { '#count': 'count' },
        ExpressionAttributeValues: { ':used': used },
      }));
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') return json(409, { error: 'Có yêu cầu khác cùng lúc, hãy thử lại.' });
      throw err;
    }
  }

  const until = now + minutes * 60_000;
  const item = {
    ...OUTAGE_KEY,
    region,
    startedAt: now,
    until,
    cooldownUntil: until + LIMITS.cooldownMinutes * 60_000,
    startedBy: session.tenantId,
    startedByOrg: session.orgName ?? null,
    startedFrom: REGION ?? null,
    expiresAt: Math.floor(until / 1000) + 86400,
  };
  try {
    // Chặn race: chỉ ghi khi chưa có sự cố nào hoặc lần trước đã qua thời gian hồi phục.
    await deps.db.send(new PutCommand({
      TableName: CONTROL_TABLE,
      Item: item,
      ConditionExpression: 'attribute_not_exists(PK) OR cooldownUntil < :now',
      ExpressionAttributeValues: { ':now': now },
    }));
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return json(409, { error: 'Vừa có người khác bắt đầu giả lập, hãy tải lại trạng thái.' });
    throw err;
  }
  console.log(JSON.stringify({ event: 'demo_failover_start', tenantId: session.tenantId, region, minutes, until: iso(until) }));
  // Dùng lại lần quan sát gần nhất (nếu còn) để POST không vượt timeout Lambda; lần poll sau sẽ đo mới.
  return json(201, await status(session, deps, now));
}

// Kết thúc sớm: không xoá bản ghi mà đặt until = bây giờ, để vẫn giữ thời gian hồi phục.
// Ai đã đăng nhập cũng được kết thúc sớm vì đây là chiều an toàn (đưa hệ thống về bình thường).
async function stop(session, deps, now) {
  const item = await readOutage(deps);
  if (outageActive(item, item?.region, now)) {
    try {
      await deps.db.send(new PutCommand({
        TableName: CONTROL_TABLE,
        Item: { ...item, until: now, endedEarlyAt: now, endedBy: session.tenantId, cooldownUntil: now + LIMITS.cooldownMinutes * 60_000 },
        ConditionExpression: '#until = :until',
        ExpressionAttributeNames: { '#until': 'until' },
        ExpressionAttributeValues: { ':until': item.until },
      }));
    } catch (err) {
      if (err.name !== 'ConditionalCheckFailedException') throw err;
    }
    console.log(JSON.stringify({ event: 'demo_failover_stop', tenantId: session.tenantId, region: item.region }));
  }
  return json(200, await status(session, deps, now));
}

export async function demoFailover(method, session, event, deps = {}) {
  const d = {
    db: deps.db ?? defaultDb,
    route53: deps.route53 ?? defaultRoute53,
    resolve4: deps.resolve4 ?? freshResolve4,
    fetchHealth: deps.fetchHealth ?? fetchHealth,
    resolvers: deps.resolvers ?? RESOLVERS,
  };
  const now = deps.now ? deps.now() : Date.now();
  if (method === 'GET') return json(200, await status(session, d, now));
  if (method === 'POST') return start(session, event, d, now);
  if (method === 'DELETE') return stop(session, d, now);
  return json(405, { error: 'Phương thức không được hỗ trợ' });
}
