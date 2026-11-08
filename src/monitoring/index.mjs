// Backend giám sát: đọc CloudWatch của cả hai Region và trả đúng hợp đồng
// monitoring-web/docs/integration/backend-api.md (kiểu: monitoring-web/src/domain/types.ts).
//
// Nguyên tắc: metric nào không có dữ liệu thì trả { kind: 'missing', reason }, không bao giờ trả 0 thay thế.
// Hàm này KHÔNG tự xác thực. Route /monitoring/* công khai theo quyết định của nhóm ngày 01/11/2026, chỉ trả số liệu tổng hợp.
import { CloudWatchClient, DescribeAlarmHistoryCommand, GetMetricDataCommand, ListMetricsCommand } from '@aws-sdk/client-cloudwatch';

const REGION_CODES = ['ap-southeast-1', 'ap-northeast-1'];
const REGION_NAMES = { 'ap-southeast-1': 'Singapore', 'ap-northeast-1': 'Tokyo' };
const RANGES = {
  '1h': { buckets: 60, bucketMs: 60_000 },
  '6h': { buckets: 72, bucketMs: 300_000 },
  '24h': { buckets: 96, bucketMs: 900_000 },
  '7d': { buckets: 84, bucketMs: 7_200_000 },
};
const LAG_MS = 2 * 60_000; // CloudWatch ghi metric trễ 1-3 phút; không lấy ô thời gian đang diễn ra
const CACHE_MS = 45_000;
const SUPPORTED_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE']);

// Tên tài nguyên lấy từ kết quả list-metrics thật trên AWS (Singapore, 23/10/2026).
// Tên API Gateway ở Tokyo CHƯA xác nhận: C phải đối chiếu rồi đặt qua biến môi trường MONITORING_CONFIG.
const DEFAULT_CONFIG = {
  routingPolicy: 'Latency-based + health check',
  healthChecks: {
    'ap-southeast-1': 'c7764d38-b17d-44df-8d44-4f2791296adc',
    'ap-northeast-1': 'bfa2df95-4abf-40d2-a240-dbd04acf735c',
  },
  dynamoTable: 'mrapi-telemetry',
  regions: {
    'ap-southeast-1': {
      apiName: 'mrapi-api-sg', stage: 'demo', lambda: 'mrapi-proxy',
      // Metric S3 Replication nằm ở Region của bucket đích, không phải Region nguồn (list-metrics thật, 01/11/2026).
      s3: { sourceBucket: 'mrapi-exports-sg', destinationBucket: 'mrapi-exports-tyo', ruleId: 'mrapi-sg-to-tyo', metricRegion: 'ap-northeast-1' },
    },
    'ap-northeast-1': {
      apiName: 'mrapi-api-tyo', stage: 'demo', lambda: 'mrapi-proxy',
      s3: { sourceBucket: 'mrapi-exports-tyo', destinationBucket: 'mrapi-exports-sg', ruleId: 'mrapi-tyo-to-sg', metricRegion: 'ap-southeast-1' },
    },
  },
};

export const loadConfig = (raw = process.env.MONITORING_CONFIG) => {
  if (!raw) return DEFAULT_CONFIG;
  const override = JSON.parse(raw);
  return {
    routingPolicy: override.routingPolicy ?? DEFAULT_CONFIG.routingPolicy,
    healthChecks: { ...DEFAULT_CONFIG.healthChecks, ...override.healthChecks },
    dynamoTable: override.dynamoTable ?? DEFAULT_CONFIG.dynamoTable,
    regions: Object.fromEntries(REGION_CODES.map((code) => [code, { ...DEFAULT_CONFIG.regions[code], ...(override.regions?.[code] ?? {}) }])),
  };
};

const value = (v) => ({ kind: 'value', value: v });
const missing = (reason) => ({ kind: 'missing', reason });
const round = (n, digits = 0) => Math.round(n * 10 ** digits) / 10 ** digits;
const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);
const mean = (m) => sum(m) / m.size;
const max = (m) => Math.max(...m.values());
const weighted = (values, weights) => {
  let num = 0; let den = 0;
  for (const [t, w] of weights) if (values.has(t)) { num += values.get(t) * w; den += w; }
  return den > 0 ? num / den : null;
};

const windowFor = (range, nowMs) => {
  const { buckets, bucketMs } = RANGES[range];
  const end = Math.floor((nowMs - LAG_MS) / bucketMs) * bucketMs;
  return { range, bucketMs, periodS: bucketMs / 1000, end, start: end - buckets * bucketMs };
};

const dimensions = (obj) => Object.entries(obj).map(([Name, Value]) => ({ Name, Value }));
const query = (id, Namespace, MetricName, dims, Stat, Period) => ({
  Id: id, ReturnData: true,
  MetricStat: { Metric: { Namespace, MetricName, Dimensions: dimensions(dims) }, Period, Stat },
});

// Trả Map<id, Map<epochMs, value>>. Id không có điểm dữ liệu thì không xuất hiện trong kết quả.
async function getMetricData(client, queries, start, end) {
  const out = new Map();
  for (let i = 0; i < queries.length; i += 400) {
    let token;
    do {
      const res = await client.send(new GetMetricDataCommand({
        MetricDataQueries: queries.slice(i, i + 400), StartTime: new Date(start), EndTime: new Date(end),
        ScanBy: 'TimestampAscending', NextToken: token,
      }));
      for (const r of res.MetricDataResults ?? []) {
        const points = out.get(r.Id) ?? new Map();
        (r.Timestamps ?? []).forEach((t, k) => points.set(new Date(t).getTime(), r.Values[k]));
        if (points.size) out.set(r.Id, points);
      }
      token = res.NextToken;
    } while (token);
  }
  return out;
}

async function fetchRegion(code, config, clientFor, win) {
  const client = clientFor(code);
  const cfg = config.regions[code];
  const other = REGION_CODES.find((c) => c !== code);
  const p = win.periodS;
  const api = { ApiName: cfg.apiName, Stage: cfg.stage };
  const fn = { FunctionName: cfg.lambda };
  const queries = [
    query('a_count', 'AWS/ApiGateway', 'Count', api, 'Sum', p),
    query('a_e4', 'AWS/ApiGateway', '4XXError', api, 'Sum', p),
    query('a_e5', 'AWS/ApiGateway', '5XXError', api, 'Sum', p),
    query('a_lat', 'AWS/ApiGateway', 'Latency', api, 'Average', p),
    query('a_p95', 'AWS/ApiGateway', 'Latency', api, 'p95', p),
    query('l_inv', 'AWS/Lambda', 'Invocations', fn, 'Sum', p),
    query('l_err', 'AWS/Lambda', 'Errors', fn, 'Sum', p),
    query('l_dur', 'AWS/Lambda', 'Duration', fn, 'Average', p),
    // Metric nhân bản được ghi ở Region nguồn, dimension ReceivingRegion là Region đích.
    query('d_rep', 'AWS/DynamoDB', 'ReplicationLatency', { TableName: config.dynamoTable, ReceivingRegion: other }, 'Average', p),
  ];
  const data = await getMetricData(client, queries, win.start, win.end);

  // Truy vấn riêng ở Region metric của S3. Dùng Maximum vì metric có điểm 0 mỗi phút khi rảnh, trung bình sẽ che lần chép chậm.
  if (cfg.s3) {
    try {
      const s3Data = await getMetricData(clientFor(cfg.s3.metricRegion ?? other),
        [query('s_rep', 'AWS/S3', 'ReplicationLatency',
          { SourceBucket: cfg.s3.sourceBucket, DestinationBucket: cfg.s3.destinationBucket, RuleId: cfg.s3.ruleId }, 'Maximum', p)], win.start, win.end);
      if (s3Data.has('s_rep')) data.set('s_rep', s3Data.get('s_rep'));
    } catch { /* s3 thành 'unavailable', không làm hỏng số liệu Region */ }
  }

  // p95 của cả khoảng xem phải là truy vấn riêng với Period = cả khoảng (không lấy trung bình các p95).
  // Tách riêng để nếu CloudWatch từ chối Period dài thì chỉ metric này thành 'unavailable'.
  let p95All = null;
  try {
    const whole = await getMetricData(client,
      [query('t_p95', 'AWS/ApiGateway', 'Latency', api, 'p95', Math.round((win.end - win.start) / 1000))], win.start, win.end);
    if (whole.get('t_p95')?.size) p95All = [...whole.get('t_p95').values()][0];
  } catch { /* để null */ }
  return { code, ok: true, data, p95All };
}

const safeFetchRegion = async (code, config, clientFor, win) => {
  try { return await fetchRegion(code, config, clientFor, win); }
  catch (error) { return { code, ok: false, error: error?.name ?? 'Error', data: new Map(), p95All: null }; }
};

function buildRegion(r, config) {
  const cfg = config.regions[r.code];
  const base = { region: r.code, healthCheck: missing('not_connected') }; // Route 53 chưa tích hợp
  const s3Absent = cfg.s3 ? missing('unavailable') : missing('not_configured');
  if (!r.ok) {
    const u = missing('unavailable');
    return {
      ...base, trafficSharePct: u, requests: u, successRatePct: u, errorRatePct: u, latencyAvgMs: u, latencyP95Ms: u,
      lambda: { invocations: u, errors: u, durationAvgMs: u }, apiGateway: { requests: u, error4xx: u, error5xx: u },
      dynamodbReplicationLatencyMs: u, s3ReplicationLatencyS: s3Absent,
    };
  }
  const d = (id) => r.data.get(id) ?? new Map();
  const count = d('a_count');
  const sumOrNull = (m, ref) => (m.size ? sum(m) : ref.size ? 0 : null); // metric lỗi chỉ xuất hiện khi có lỗi
  const requests = count.size ? sum(count) : null;
  const e4 = sumOrNull(d('a_e4'), count);
  const e5 = sumOrNull(d('a_e5'), count);
  const m = (v, digits = 0) => (v === null || v === undefined ? missing('unavailable') : value(round(v, digits)));
  const errorPct = requests > 0 ? ((e4 + e5) / requests) * 100 : null;
  const inv = d('l_inv');
  return {
    ...base,
    trafficSharePct: missing('unavailable'), // điền ở bước ghép hai Region
    requests: m(requests),
    successRatePct: errorPct === null ? missing('unavailable') : value(round(100 - errorPct, 2)),
    errorRatePct: m(errorPct, 2),
    latencyAvgMs: m(weighted(d('a_lat'), count)),
    latencyP95Ms: m(r.p95All),
    lambda: {
      invocations: m(inv.size ? sum(inv) : null),
      errors: m(sumOrNull(d('l_err'), inv)),
      durationAvgMs: m(weighted(d('l_dur'), inv)),
    },
    apiGateway: { requests: m(requests), error4xx: m(e4), error5xx: m(e5) },
    dynamodbReplicationLatencyMs: d('d_rep').size ? value(round(mean(d('d_rep')))) : missing('unavailable'),
    s3ReplicationLatencyS: !cfg.s3 ? s3Absent : d('s_rep').size ? value(round(max(d('s_rep')), 1)) : s3Absent,
  };
}

function buildSeries(results, win) {
  const series = [];
  for (let t = win.start; t < win.end; t += win.bucketMs) {
    const regions = {};
    let any = false;
    for (const r of results) {
      const d = (id) => r.data.get(id)?.get(t);
      const requests = d('a_count');
      if (requests !== undefined) any = true;
      const req = requests ?? 0;
      const error4xx = d('a_e4') ?? 0;
      const error5xx = d('a_e5') ?? 0;
      regions[r.code] = {
        requests: req, success: Math.max(0, req - error4xx - error5xx), error4xx, error5xx,
        latencyAvgMs: round(d('a_lat') ?? 0), latencyP95Ms: round(d('a_p95') ?? 0),
      };
    }
    if (any) series.push({ t, regions }); // ô không có dữ liệu ở cả hai Region thì bỏ qua
  }
  return series;
}

function buildSnapshot(range, win, results, config, generatedAt) {
  if (results.every((r) => !r.ok)) {
    throw Object.assign(new Error(`CloudWatch lỗi ở cả hai Region (${results.map((r) => r.error).join(', ')})`), { status: 502 });
  }
  const regions = results.map((r) => buildRegion(r, config));
  const totals = regions.map((r) => (r.requests.kind === 'value' ? r.requests.value : null));
  if (totals.every((v) => v !== null) && totals[0] + totals[1] > 0) {
    // Tỷ lệ traffic chỉ tính khi cả hai Region đều có số liệu, để không báo 100% do thiếu dữ liệu của Region kia.
    regions.forEach((r, i) => { r.trafficSharePct = value(round((totals[i] / (totals[0] + totals[1])) * 100, 1)); });
  }
  return { dataMode: 'live', generatedAt, range, routingPolicy: missing('not_connected'), regions, series: buildSeries(results, win) };
}

async function fetchEndpoints(code, config, client, win) {
  const cfg = config.regions[code];
  const apiDims = [{ Name: 'ApiName', Value: cfg.apiName }, { Name: 'Stage', Value: cfg.stage }];
  const combos = new Map();
  let token;
  do {
    const res = await client.send(new ListMetricsCommand({ Namespace: 'AWS/ApiGateway', MetricName: 'Count', Dimensions: apiDims, NextToken: token }));
    for (const metric of res.Metrics ?? []) {
      const resource = metric.Dimensions.find((x) => x.Name === 'Resource')?.Value;
      const method = metric.Dimensions.find((x) => x.Name === 'Method')?.Value;
      if (resource && method && SUPPORTED_METHODS.has(method)) combos.set(`${method} ${resource}`, { method, resource });
    }
    token = res.NextToken;
  } while (token && combos.size < 100);
  const list = [...combos.values()];
  if (!list.length) return [];
  const queries = list.flatMap(({ method, resource }, i) => {
    const dims = { ApiName: cfg.apiName, Stage: cfg.stage, Resource: resource, Method: method };
    return [
      query(`c${i}`, 'AWS/ApiGateway', 'Count', dims, 'Sum', win.periodS),
      query(`e4${i}`, 'AWS/ApiGateway', '4XXError', dims, 'Sum', win.periodS),
      query(`e5${i}`, 'AWS/ApiGateway', '5XXError', dims, 'Sum', win.periodS),
      query(`l${i}`, 'AWS/ApiGateway', 'Latency', dims, 'Average', win.periodS),
    ];
  });
  const data = await getMetricData(client, queries, win.start, win.end);
  const stats = [];
  list.forEach(({ method, resource }, i) => {
    const count = data.get(`c${i}`);
    if (!count?.size) return;
    const requests = sum(count);
    const errors = (data.get(`e4${i}`) ? sum(data.get(`e4${i}`)) : 0) + (data.get(`e5${i}`) ? sum(data.get(`e5${i}`)) : 0);
    const lat = data.get(`l${i}`);
    stats.push({
      method, path: resource, region: code, requests,
      successRatePct: round(100 - (errors / requests) * 100, 2), errorRatePct: round((errors / requests) * 100, 2),
      latencyAvgMs: lat ? round(weighted(lat, count) ?? 0) : 0,
      lastUpdated: Math.max(...count.keys()),
    });
  });
  return stats;
}

async function fetchAlarmEvents(code, client, nowMs) {
  const items = [];
  let token;
  for (let page = 0; page < 5; page += 1) {
    const res = await client.send(new DescribeAlarmHistoryCommand({
      HistoryItemType: 'StateUpdate', StartDate: new Date(nowMs - 7 * 86_400_000), EndDate: new Date(nowMs),
      ScanBy: 'TimestampAscending', MaxRecords: 100, NextToken: token,
    }));
    items.push(...(res.AlarmHistoryItems ?? []));
    token = res.NextToken;
    if (!token) break;
  }
  const open = new Map();
  const events = [];
  for (const item of items) {
    let state;
    try { state = JSON.parse(item.HistoryData ?? '{}')?.newState?.stateValue; } catch { state = undefined; }
    const ts = new Date(item.Timestamp).getTime();
    if (state === 'ALARM' && !open.has(item.AlarmName)) {
      const event = {
        id: `${code}:${item.AlarmName}:${ts}`, kind: 'incident', origin: 'aws', region: code,
        title: `Alarm ${item.AlarmName} chuyển sang ALARM`, description: item.HistorySummary ?? '',
        startedAt: ts, endedAt: null,
        recoverySeconds: null, // thời gian ở trạng thái ALARM không phải thời gian phục hồi đã đo; không điền ước lượng
        evidence: [{ label: 'Alarm', detail: item.AlarmName }, { label: 'Region', detail: code }],
      };
      open.set(item.AlarmName, event);
      events.push(event);
    } else if (state === 'OK' && open.has(item.AlarmName)) {
      open.get(item.AlarmName).endedAt = ts;
      open.delete(item.AlarmName);
    }
  }
  return events;
}

export function createService({ clientFor, config = DEFAULT_CONFIG, now = () => Date.now() }) {
  const cache = new Map();
  const cached = async (key, load) => {
    const hit = cache.get(key);
    if (hit && now() - hit.at < CACHE_MS) return hit.value;
    const result = await load();
    cache.set(key, { at: now(), value: result });
    return result;
  };
  const collect = (range) => cached(`collect:${range}`, async () => {
    const generatedAt = now();
    const win = windowFor(range, generatedAt);
    const results = await Promise.all(REGION_CODES.map((code) => safeFetchRegion(code, config, clientFor, win)));
    return { generatedAt, win, results };
  });
  const alarms = () => cached('alarms', async () => {
    const byRegion = await Promise.all(REGION_CODES.map(async (code) => {
      try { return { code, ok: true, events: await fetchAlarmEvents(code, clientFor(code), now()) }; }
      catch (error) { return { code, ok: false, error: error?.name ?? 'Error', events: [] }; }
    }));
    return byRegion;
  });
  const health = () => cached('health', async () => {
    try {
      const end = now();
      const queries = REGION_CODES.map((code, i) => query(`h${i}`, 'AWS/Route53', 'HealthCheckStatus',
        { HealthCheckId: config.healthChecks[code] }, 'Minimum', 60));
      const data = await getMetricData(clientFor('us-east-1'), queries, end - 5 * 60_000, end);
      return Object.fromEntries(REGION_CODES.map((code, i) => {
        const points = data.get(`h${i}`);
        const latest = points?.size ? [...points].sort((a, b) => b[0] - a[0])[0][1] : undefined;
        return [code, latest === undefined ? missing('unavailable') : value(latest === 1 ? 'healthy' : 'unhealthy')];
      }));
    } catch {
      return Object.fromEntries(REGION_CODES.map((code) => [code, missing('unavailable')]));
    }
  });

  return {
    async snapshot(range) {
      const { generatedAt, win, results } = await collect(range);
      const snapshot = buildSnapshot(range, win, results, config, generatedAt);
      const checks = await health();
      snapshot.regions.forEach((r) => { r.healthCheck = checks[r.region]; });
      snapshot.routingPolicy = value(config.routingPolicy);
      return snapshot;
    },
    async endpoints(range) {
      return cached(`endpoints:${range}`, async () => {
        const win = windowFor(range, now());
        const settled = await Promise.all(REGION_CODES.map(async (code) => {
          try { return { ok: true, stats: await fetchEndpoints(code, config, clientFor(code), win) }; }
          catch (error) { return { ok: false, error: error?.name ?? 'Error', stats: [] }; }
        }));
        if (settled.every((s) => !s.ok)) throw Object.assign(new Error('CloudWatch lỗi ở cả hai Region'), { status: 502 });
        return settled.flatMap((s) => s.stats).sort((a, b) => b.requests - a.requests);
      });
    },
    async incidents() {
      const byRegion = await alarms();
      if (byRegion.every((r) => !r.ok)) throw Object.assign(new Error('CloudWatch lỗi ở cả hai Region'), { status: 502 });
      return byRegion.flatMap((r) => r.events).sort((a, b) => b.startedAt - a.startedAt).slice(0, 50);
    },
    async sources() {
      const { generatedAt, results } = await collect('1h');
      const alarmState = await alarms();
      const checks = await health();
      const note = (list, has) => list.map((r) => `${REGION_NAMES[r.code]}: ${r.ok === false ? `lỗi ${r.error}` : has(r) ? 'có dữ liệu trong 1 giờ qua' : 'không có dữ liệu trong 1 giờ qua'}`).join('; ');
      const statusOf = (list) => (list.every((r) => r.ok === false) ? 'error' : 'connected');
      const src = (id, service, regions, list, metrics, has, guide, extra = '') => {
        const status = statusOf(list);
        return { id, service, regions, status, metrics, lastSync: status === 'connected' ? generatedAt : null, note: `${note(list, has)}${extra}`, guide };
      };
      const metricHas = (id) => (r) => r.data.has(id);
      const notConnected = (id, service, metrics, note2, guide) => ({ id, service, regions: 'Cả hai Region', status: 'not_connected', metrics, lastSync: null, note: note2, guide });
      return [
        src('api-gateway', 'API Gateway', 'Singapore, Tokyo', results, ['Count', '4XXError', '5XXError', 'Latency'], metricHas('a_count'), 'monitoring-web/docs/integration/api-gateway.md'),
        src('lambda', 'Lambda', 'Singapore, Tokyo', results, ['Invocations', 'Errors', 'Duration'], metricHas('l_inv'), 'monitoring-web/docs/integration/lambda.md'),
        src('dynamodb-replication', 'DynamoDB Global Tables', 'Singapore, Tokyo', results, ['ReplicationLatency'], metricHas('d_rep'), 'monitoring-web/docs/integration/dynamodb-global-tables.md'),
        src('s3-replication', 'S3 Replication', 'Singapore, Tokyo', results, ['ReplicationLatency'], metricHas('s_rep'), 'monitoring-web/docs/integration/s3-replication.md',
        REGION_CODES.filter((code) => !config.regions[code].s3).map((code) => `; ${REGION_NAMES[code]}: not_configured (chưa cấu hình truy vấn S3 Replication Metrics)`).join('')),
        src('cloudwatch-alarms', 'CloudWatch Alarms', 'Singapore, Tokyo', alarmState, ['AlarmHistory'], (r) => r.events.length > 0, 'monitoring-web/docs/integration/cloudwatch.md'),
        { id: 'route53', service: 'Route 53', regions: 'Singapore, Tokyo',
          status: REGION_CODES.every((code) => checks[code].kind === 'missing') ? 'error' : 'connected',
          metrics: ['HealthCheckStatus'], lastSync: generatedAt,
          note: 'HealthCheckStatus thật từ CloudWatch us-east-1; routing policy theo cấu hình triển khai. Có thể trễ một chu kỳ metric.',
          guide: 'monitoring-web/docs/integration/route53.md' },
        notConnected('xray', 'X-Ray', ['Trace'], 'Chưa tích hợp', 'monitoring-web/docs/integration/cloudwatch.md'),
      ];
    },
  };
}

let defaultService;
const clients = new Map();
const realService = () => {
  defaultService ??= createService({
    config: loadConfig(),
    clientFor: (region) => { if (!clients.has(region)) clients.set(region, new CloudWatchClient({ region })); return clients.get(region); },
  });
  return defaultService;
};

const ROUTE = /\/monitoring\/(snapshot|endpoints|incidents|sources)\/?$/;

export const handleRequest = async (event, service) => {
  const origin = process.env.MONITORING_ALLOWED_ORIGIN; // cố định theo deployment, không phản chiếu Origin của request
  const cors = origin ? {
    'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization', Vary: 'Origin',
  } : {};
  const respond = (statusCode, body) => ({
    statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors },
    body: body === undefined ? '' : JSON.stringify(body),
  });
  if (event.httpMethod === 'OPTIONS') return respond(204);
  if (event.httpMethod !== 'GET') return respond(405, { error: 'method_not_allowed' });
  const name = ROUTE.exec(event.path ?? '')?.[1];
  if (!name) return respond(404, { error: 'not_found' });
  const range = event.queryStringParameters?.range ?? '6h';
  if (!(range in RANGES)) return respond(400, { error: 'invalid_range', allowed: Object.keys(RANGES) });
  try {
    return respond(200, await service[name](range));
  } catch (error) {
    console.error('monitoring_error', error?.name, error?.message);
    return respond(error?.status ?? 502, { error: 'upstream_error', detail: error?.name ?? 'Error' });
  }
};

// Lambda truyền context ở đối số thứ hai, không phải service của ứng dụng.
export const handler = async (event, _context) => handleRequest(event, realService());
