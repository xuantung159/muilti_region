// Backend giám sát: đọc CloudWatch của cả hai Region và trả đúng hợp đồng
// monitoring-web/docs/integration/backend-api.md (kiểu: monitoring-web/src/domain/types.ts).
//
// Nguyên tắc: metric nào không có dữ liệu thì trả { kind: 'missing', reason }, không bao giờ trả 0 thay thế.
// Báo cáo yêu cầu phiên đăng nhập còn hạn và API key đã đăng ký còn hoạt động.
import { authorizeReport, isReportAdmin } from './report-auth.mjs';
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
const SUPPORTED_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'ANY']);

// "Request" trên dashboard = request người dùng gửi tới API doanh nghiệp qua /proxy/{apiId}/...
// Metric Count cấp stage gồm cả traffic hệ thống: Route 53 health check gọi GET /health mỗi 30 giây
// từ nhiều điểm kiểm tra, portal gọi /api/* (đăng ký, đăng nhập...) và chính dashboard gọi /monitoring/*.
// Nếu lấy Count cấp stage, tài khoản vừa đăng ký chưa gọi API nào vẫn thấy hàng nghìn request.
// Stage demo bật detailed metrics (methodSettings */* metricsEnabled), nên lọc được theo dimension Resource.
export const isUserResource = (resource) => resource === '/proxy' || String(resource ?? '').startsWith('/proxy/');
export const isHealthResource = (resource) => resource === '/health';

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

// Các cặp (Resource, Method) có metric Count trên stage. CloudWatch chỉ liệt kê metric có dữ liệu trong 2 tuần gần nhất.
async function listResourceMethods(client, cfg) {
  const apiDims = [{ Name: 'ApiName', Value: cfg.apiName }, { Name: 'Stage', Value: cfg.stage }];
  const combos = new Map();
  let token;
  do {
    const res = await client.send(new ListMetricsCommand({ Namespace: 'AWS/ApiGateway', MetricName: 'Count', Dimensions: apiDims, NextToken: token }));
    for (const metric of res.Metrics ?? []) {
      const resource = metric.Dimensions?.find((x) => x.Name === 'Resource')?.Value;
      const method = metric.Dimensions?.find((x) => x.Name === 'Method')?.Value;
      if (resource && method) combos.set(`${method} ${resource}`, { method, resource });
    }
    token = res.NextToken;
  } while (token && combos.size < 100);
  return [...combos.values()];
}

// Gộp metric của nhiều resource /proxy thành một chuỗi theo thời gian.
const mergeSum = (maps) => {
  const out = new Map();
  for (const m of maps) for (const [t, v] of m) out.set(t, (out.get(t) ?? 0) + v);
  return out;
};
const mergeWeighted = (pairs) => {
  const num = new Map(); const den = new Map();
  for (const { values, weights } of pairs) {
    for (const [t, w] of weights) {
      if (!values.has(t)) continue;
      num.set(t, (num.get(t) ?? 0) + values.get(t) * w);
      den.set(t, (den.get(t) ?? 0) + w);
    }
  }
  const out = new Map();
  for (const [t, d] of den) if (d > 0) out.set(t, num.get(t) / d);
  return out;
};
// p95 không cộng hay lấy trung bình được giữa các resource; lấy giá trị lớn nhất (cận trên, không báo thấp hơn thực tế).
const mergeMax = (maps) => {
  const out = new Map();
  for (const m of maps) for (const [t, v] of m) out.set(t, Math.max(out.get(t) ?? -Infinity, v));
  return out;
};

async function fetchRegion(code, config, clientFor, win) {
  const client = clientFor(code);
  const cfg = config.regions[code];
  const other = REGION_CODES.find((c) => c !== code);
  const p = win.periodS;
  const api = { ApiName: cfg.apiName, Stage: cfg.stage };
  const fn = { FunctionName: cfg.lambda };
  const routes = await listResourceMethods(client, cfg);
  const userRoutes = routes.filter((r) => isUserResource(r.resource));
  const healthRoutes = routes.filter((r) => isHealthResource(r.resource));
  const routeDims = ({ resource, method }) => ({ ...api, Resource: resource, Method: method });
  const queries = [
    // Cấp stage: toàn bộ traffic qua API Gateway, gồm health check, portal và monitoring.
    // Chỉ dùng cho mục "API Gateway (toàn stage)", không dùng làm số request của người dùng.
    query('a_count', 'AWS/ApiGateway', 'Count', api, 'Sum', p),
    query('a_e4', 'AWS/ApiGateway', '4XXError', api, 'Sum', p),
    query('a_e5', 'AWS/ApiGateway', '5XXError', api, 'Sum', p),
    // Request người dùng: chỉ resource /proxy/...
    ...userRoutes.flatMap((r, i) => [
      query(`u_c${i}`, 'AWS/ApiGateway', 'Count', routeDims(r), 'Sum', p),
      query(`u_e4${i}`, 'AWS/ApiGateway', '4XXError', routeDims(r), 'Sum', p),
      query(`u_e5${i}`, 'AWS/ApiGateway', '5XXError', routeDims(r), 'Sum', p),
      query(`u_l${i}`, 'AWS/ApiGateway', 'Latency', routeDims(r), 'Average', p),
      query(`u_p${i}`, 'AWS/ApiGateway', 'Latency', routeDims(r), 'p95', p),
    ]),
    // Route 53 health check (GET /health): tách riêng để giải thích phần lớn số request toàn stage.
    ...healthRoutes.map((r, i) => query(`h_c${i}`, 'AWS/ApiGateway', 'Count', routeDims(r), 'Sum', p)),
    query('l_inv', 'AWS/Lambda', 'Invocations', fn, 'Sum', p),
    query('l_err', 'AWS/Lambda', 'Errors', fn, 'Sum', p),
    query('l_dur', 'AWS/Lambda', 'Duration', fn, 'Average', p),
    // Metric nhân bản được ghi ở Region nguồn, dimension ReceivingRegion là Region đích.
    query('d_rep', 'AWS/DynamoDB', 'ReplicationLatency', { TableName: config.dynamoTable, ReceivingRegion: other }, 'Average', p),
  ];
  const data = await getMetricData(client, queries, win.start, win.end);
  const pick = (prefix) => userRoutes.map((_, i) => data.get(`${prefix}${i}`) ?? new Map());
  const counts = pick('u_c');
  const merged = {
    u_count: mergeSum(counts),
    u_e4: mergeSum(pick('u_e4')),
    u_e5: mergeSum(pick('u_e5')),
    u_lat: mergeWeighted(pick('u_l').map((values, i) => ({ values, weights: counts[i] }))),
    u_p95: mergeMax(pick('u_p')),
    h_count: mergeSum(healthRoutes.map((_, i) => data.get(`h_c${i}`) ?? new Map())),
  };
  for (const [id, points] of Object.entries(merged)) if (points.size) data.set(id, points);

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
  // Chỉ tính resource /proxy; nhiều resource thì lấy p95 lớn nhất (cận trên).
  let p95All = null;
  if (userRoutes.length) {
    try {
      const whole = await getMetricData(client, userRoutes.map((r, i) =>
        query(`t_p95${i}`, 'AWS/ApiGateway', 'Latency', routeDims(r), 'p95', Math.round((win.end - win.start) / 1000))), win.start, win.end);
      const values = userRoutes.flatMap((_, i) => [...(whole.get(`t_p95${i}`)?.values() ?? [])]);
      if (values.length) p95All = Math.max(...values);
    } catch { /* để null */ }
  }
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
      ...base, trafficSharePct: u, requests: u, successRatePct: u, errorRatePct: u, serverErrorRatePct: u, latencyAvgMs: u, latencyP95Ms: u,
      lambda: { invocations: u, errors: u, durationAvgMs: u },
      apiGateway: { requests: u, error4xx: u, error5xx: u, healthCheckRequests: u, proxyRequests: u },
      dynamodbReplicationLatencyMs: u, s3ReplicationLatencyS: s3Absent,
    };
  }
  const d = (id) => r.data.get(id) ?? new Map();
  const stageCount = d('a_count');
  const count = d('u_count');
  const sumOrNull = (m, ref) => (m.size ? sum(m) : ref.size ? 0 : null); // metric lỗi chỉ xuất hiện khi có lỗi
  // Stage có số liệu (API Gateway đang báo metric) mà /proxy không có điểm nào nghĩa là đã đo và bằng 0,
  // ví dụ tài khoản vừa đăng ký: chỉ có health check và portal. Stage cũng không có số liệu thì là missing.
  const requests = count.size ? sum(count) : stageCount.size ? 0 : null;
  const e4 = count.size ? sumOrNull(d('u_e4'), count) : requests;
  const e5 = count.size ? sumOrNull(d('u_e5'), count) : requests;
  const stageRequests = stageCount.size ? sum(stageCount) : null;
  const stageE4 = sumOrNull(d('a_e4'), stageCount);
  const stageE5 = sumOrNull(d('a_e5'), stageCount);
  const m = (v, digits = 0) => (v === null || v === undefined ? missing('unavailable') : value(round(v, digits)));
  const errorPct = requests > 0 ? ((e4 + e5) / requests) * 100 : null;
  const inv = d('l_inv');
  return {
    ...base,
    trafficSharePct: missing('unavailable'), // điền ở bước ghép hai Region
    requests: m(requests),
    successRatePct: errorPct === null ? missing('unavailable') : value(round(100 - errorPct, 2)),
    errorRatePct: m(errorPct, 2),
    // Chỉ 5xx: lỗi phía gateway/backend. 4xx (key sai, route sai) là lỗi của client nên không làm Region "Down".
    serverErrorRatePct: m(requests > 0 ? (e5 / requests) * 100 : null, 2),
    latencyAvgMs: m(d('u_lat').size ? weighted(d('u_lat'), count) : null),
    latencyP95Ms: m(r.p95All),
    lambda: {
      invocations: m(inv.size ? sum(inv) : null),
      errors: m(sumOrNull(d('l_err'), inv)),
      durationAvgMs: m(weighted(d('l_dur'), inv)),
    },
    // Số liệu dùng chung toàn hệ thống (mọi doanh nghiệp + traffic hệ thống), không phải của riêng key nào.
    // healthCheckRequests: GET /health do Route 53 gọi; proxyRequests: /proxy của mọi doanh nghiệp cộng lại.
    apiGateway: {
      requests: m(stageRequests), error4xx: m(stageE4), error5xx: m(stageE5),
      healthCheckRequests: m(sumOrNull(d('h_count'), stageCount)),
      proxyRequests: m(requests),
    },
    dynamodbReplicationObservedAt: d('d_rep').size ? Math.max(...d('d_rep').keys()) : null,
    s3ReplicationObservedAt: d('s_rep').size ? Math.max(...d('s_rep').keys()) : null,
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
      // Ô có số liệu cấp stage mà không có request /proxy là ô đã đo, bằng 0.
      if (d('a_count') !== undefined || d('u_count') !== undefined) any = true;
      const req = d('u_count') ?? 0;
      const error4xx = d('u_e4') ?? 0;
      const error5xx = d('u_e5') ?? 0;
      regions[r.code] = {
        requests: req, success: Math.max(0, req - error4xx - error5xx), error4xx, error5xx,
        latencyAvgMs: round(d('u_lat') ?? 0), latencyP95Ms: round(d('u_p95') ?? 0),
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

// Chỉ liệt kê endpoint của API doanh nghiệp (/proxy/...). /health, /api/* và /monitoring/* là traffic hệ thống.
async function fetchEndpoints(code, config, client, win) {
  const cfg = config.regions[code];
  const list = (await listResourceMethods(client, cfg)).filter((r) => isUserResource(r.resource) && SUPPORTED_METHODS.has(r.method));
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
    const e5 = data.get(`e5${i}`) ? sum(data.get(`e5${i}`)) : 0;
    const errors = (data.get(`e4${i}`) ? sum(data.get(`e4${i}`)) : 0) + e5;
    const lat = data.get(`l${i}`);
    stats.push({
      method, path: resource, region: code, requests,
      successRatePct: round(100 - (errors / requests) * 100, 2), errorRatePct: round((errors / requests) * 100, 2),
      serverErrorRatePct: round((e5 / requests) * 100, 2),
      latencyAvgMs: lat ? round(weighted(lat, count) ?? 0) : 0,
      lastUpdated: Math.max(...count.keys()),
    });
  });
  return stats;
}

// Request đến từ quốc gia nào và được Region nào phục vụ. Nguồn: metric MRAPI/Routing Requests do
// mrapi-proxy ghi bằng Embedded Metric Format, mỗi Region tự ghi metric của mình. Chỉ có request /proxy.
const ROUTING_NS = 'MRAPI/Routing';
const COUNTRY_RE = /^[A-Z]{2}$/;

async function fetchRoutes(code, client, win, bucketMs) {
  const combos = new Map();
  let token;
  do {
    const res = await client.send(new ListMetricsCommand({ Namespace: ROUTING_NS, MetricName: 'Requests', NextToken: token }));
    for (const metric of res.Metrics ?? []) {
      const country = metric.Dimensions?.find((x) => x.Name === 'Country')?.Value;
      const servedRegion = metric.Dimensions?.find((x) => x.Name === 'ServedRegion')?.Value;
      if (COUNTRY_RE.test(country ?? '') && REGION_CODES.includes(servedRegion)) combos.set(`${country}|${servedRegion}`, { country, servedRegion });
    }
    token = res.NextToken;
  } while (token && combos.size < 250);
  const list = [...combos.values()];
  if (!list.length) return [];
  // Ô nhỏ như các biểu đồ (1h: 1 phút, 6h: 5 phút...) để lastSeen là ô có request gần nhất, không phải đầu khoảng.
  const period = Math.max(60, Math.round(bucketMs / 1000));
  const data = await getMetricData(client, list.map(({ country, servedRegion }, i) =>
    query(`r${i}`, ROUTING_NS, 'Requests', { Country: country, ServedRegion: servedRegion }, 'Sum', period)), win.start, win.end);
  return list.flatMap((r, i) => {
    const points = data.get(`r${i}`);
    if (!points?.size) return [];
    return [{ ...r, requests: sum(points), lastSeen: Math.max(...points.keys()) }];
  });
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
        recoverySeconds: null, // điền khi alarm về OK
        evidence: [{ label: 'Alarm', detail: item.AlarmName }, { label: 'Region', detail: code }],
      };
      open.set(item.AlarmName, event);
      events.push(event);
    } else if (state === 'OK' && open.has(item.AlarmName)) {
      const event = open.get(item.AlarmName);
      event.endedAt = ts;
      // Thời gian phục hồi = mốc ALARM → OK ghi trong AlarmHistory (độ chính xác theo chu kỳ đánh giá của alarm).
      event.recoverySeconds = Math.round((ts - event.startedAt) / 1000);
      event.evidence.push({ label: 'Cách đo phục hồi', detail: 'AlarmHistory: mốc ALARM → OK của chính alarm này' });
      open.delete(item.AlarmName);
    }
  }
  return events;
}

// Failover thật của Route 53: health check của một Region về 0 (unhealthy) thì Route 53 rút Region đó khỏi
// câu trả lời DNS, traffic sang Region còn lại; về 1 là Region được đưa lại. Nguồn: HealthCheckStatus (us-east-1),
// ô 1 phút, Minimum. CloudWatch giữ ô 1 phút 15 ngày nên xem được 7 ngày gần nhất.
export function healthEvents(code, points, otherCode) {
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  const events = [];
  let current = null;
  for (const [t, v] of sorted) {
    if (v < 1 && !current) {
      current = {
        id: `${code}:route53:${t}`, kind: 'traffic_shift', origin: 'aws', region: code,
        title: `Route 53 rút ${REGION_NAMES[code]} khỏi DNS, traffic sang ${REGION_NAMES[otherCode]}`,
        description: `Health check của ${REGION_NAMES[code]} báo unhealthy nên Route 53 chỉ trả bản ghi ${REGION_NAMES[otherCode]}. Sự kiện kết thúc khi health check healthy trở lại.`,
        startedAt: t, endedAt: null, recoverySeconds: null,
        evidence: [{ label: 'Nguồn', detail: 'CloudWatch AWS/Route53 HealthCheckStatus (us-east-1), ô 1 phút' }],
      };
      events.push(current);
    } else if (v >= 1 && current) {
      current.endedAt = t;
      current.recoverySeconds = Math.round((t - current.startedAt) / 1000);
      current.evidence.push({ label: 'Cách đo phục hồi', detail: 'Phút đầu tiên health check về 0 → phút đầu tiên về 1 (sai số ±60 giây)' });
      current = null;
    }
  }
  return events;
}

async function fetchHealthEvents(config, client, nowMs) {
  const end = Math.floor(nowMs / 60_000) * 60_000;
  const queries = REGION_CODES.map((code, i) => query(`hh${i}`, 'AWS/Route53', 'HealthCheckStatus',
    { HealthCheckId: config.healthChecks[code] }, 'Minimum', 60));
  const data = await getMetricData(client, queries, end - 7 * 86_400_000, end);
  return REGION_CODES.flatMap((code, i) => {
    const points = data.get(`hh${i}`);
    if (!points?.size) return [];
    const evs = healthEvents(code, points, REGION_CODES.find((c) => c !== code));
    for (const e of evs) e.evidence.push({ label: 'Health check', detail: config.healthChecks[code] });
    return evs;
  });
}

// Đối chiếu X-Ray: lấy trace trong khoảng sự cố ở đúng Region (X-Ray là dịch vụ theo Region).
// Sampling chỉ giữ một phần request (rule Default: 1 request/giây + 5%), nên số trace là mẫu, không phải tổng request.
const XRAY_MAX_WINDOW_MS = 6 * 3_600_000;
const XRAY_PAD_MS = 2 * 60_000;
const XRAY_MAX_PAGES = 5;
export const xrayTraceUrl = (region, traceId) => `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#xray:traces/${traceId}`;
export const xrayQueryUrl = (region, start, end) => {
  const iso = (ms) => new Date(ms).toISOString();
  return `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#xray:traces/query?~(query~(expression~'fault*20*3d*20true)~context~(timeRange~(end~'${iso(end)}~start~'${iso(start)})))`;
};

export async function correlateXRay(event, xray, nowMs) {
  const start = event.startedAt - XRAY_PAD_MS;
  const end = Math.min(event.endedAt === null ? nowMs : event.endedAt + XRAY_PAD_MS, start + XRAY_MAX_WINDOW_MS, nowMs);
  const out = { status: 'connected', start, end, traces: 0, faults: 0, errors: 0, throttles: 0, firstFaultAt: null, lastFaultAt: null, truncated: false, sampleTraceIds: [], consoleUrl: xrayQueryUrl(event.region, start, end) };
  let token;
  let page = 0;
  do {
    const res = await xray.getTraceSummaries({ StartTime: new Date(start), EndTime: new Date(end), Sampling: false, NextToken: token });
    for (const s of res.TraceSummaries ?? []) {
      out.traces += 1;
      if (s.HasError) out.errors += 1;
      if (s.HasThrottle) out.throttles += 1;
      if (!s.HasFault) continue;
      out.faults += 1;
      // Mã trace X-Ray có dạng 1-{epoch giây hex}-{ngẫu nhiên}; StartTime chỉ có ở SDK mới.
      const at = s.StartTime ? new Date(s.StartTime).getTime() : parseInt(String(s.Id).split('-')[1], 16) * 1000;
      if (Number.isFinite(at)) {
        out.firstFaultAt = out.firstFaultAt === null ? at : Math.min(out.firstFaultAt, at);
        out.lastFaultAt = out.lastFaultAt === null ? at : Math.max(out.lastFaultAt, at);
      }
      if (out.sampleTraceIds.length < 5) out.sampleTraceIds.push(s.Id);
    }
    token = res.NextToken;
    page += 1;
  } while (token && page < XRAY_MAX_PAGES);
  out.truncated = Boolean(token);
  return out;
}

const XRAY_EVENTS = 20; // chỉ đối chiếu các sự kiện gần nhất để giới hạn số lời gọi X-Ray

export function createService({ clientFor, xrayFor = null, config = DEFAULT_CONFIG, now = () => Date.now() }) {
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
  const failovers = () => cached('failovers', async () => {
    try { return { ok: true, events: await fetchHealthEvents(config, clientFor('us-east-1'), now()) }; }
    catch (error) { return { ok: false, error: error?.name ?? 'Error', events: [] }; }
  });
  const withTraces = (list) => cached(`xray:${list[0]?.id ?? ''}:${list.length}`, async () => {
    const at = now();
    return Promise.all(list.map(async (e, i) => {
      if (i >= XRAY_EVENTS || e.region === 'global') return e;
      if (!xrayFor) return { ...e, xray: { status: 'not_connected' } };
      try { return { ...e, xray: await correlateXRay(e, xrayFor(e.region), at) }; }
      catch (error) { return { ...e, xray: { status: 'error', detail: error?.name ?? 'Error' } }; }
    }));
  });
  // Trang Nguồn dữ liệu: đếm trace 1 giờ qua ở mỗi Region (một trang kết quả) để biết X-Ray đọc được.
  const xrayProbe = () => (!xrayFor ? Promise.resolve(null) : cached('xray-probe', async () => {
    const end = now();
    return Promise.all(REGION_CODES.map(async (code) => {
      try {
        const res = await xrayFor(code).getTraceSummaries({ StartTime: new Date(end - 3_600_000), EndTime: new Date(end), Sampling: false });
        return { code, ok: true, traces: (res.TraceSummaries ?? []).length + (res.NextToken ? '+' : '') };
      } catch (error) { return { code, ok: false, error: error?.name ?? 'Error' }; }
    }));
  }));
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
    async routes(range) {
      return cached(`routes:${range}`, async () => {
        // Không trừ LAG_MS như các metric AWS: metric EMF của chính mình có sớm hơn, lấy đến hiện tại.
        const end = now();
        const win = { start: end - RANGES[range].buckets * RANGES[range].bucketMs, end };
        const settled = await Promise.all(REGION_CODES.map(async (code) => {
          try { return { ok: true, routes: await fetchRoutes(code, clientFor(code), win, RANGES[range].bucketMs) }; }
          catch (error) { return { ok: false, error: error?.name ?? 'Error', routes: [] }; }
        }));
        if (settled.every((s) => !s.ok)) throw Object.assign(new Error('CloudWatch lỗi ở cả hai Region'), { status: 502 });
        return settled.flatMap((s) => s.routes).sort((a, b) => b.requests - a.requests);
      });
    },
    async incidents() {
      const [byRegion, shifts] = await Promise.all([alarms(), failovers()]);
      if (byRegion.every((r) => !r.ok) && !shifts.ok) throw Object.assign(new Error('CloudWatch lỗi ở cả hai Region'), { status: 502 });
      const list = [...byRegion.flatMap((r) => r.events), ...shifts.events].sort((a, b) => b.startedAt - a.startedAt).slice(0, 50);
      return withTraces(list);
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
      const base = { id: 'xray', service: 'X-Ray', regions: 'Singapore, Tokyo', metrics: ['GetTraceSummaries'], guide: 'monitoring-web/docs/integration/xray.md' };
      const states = await xrayProbe();
      const xraySource = () => {
        if (!states) return { ...base, status: 'not_connected', lastSync: null, note: 'Chưa cấu hình client X-Ray' };
        return {
          ...base,
          status: states.every((x) => !x.ok) ? 'error' : 'connected',
          lastSync: states.some((x) => x.ok) ? generatedAt : null,
          note: `${states.map((x) => `${REGION_NAMES[x.code]}: ${x.ok ? `${x.traces} trace trong 1 giờ qua` : `lỗi ${x.error}`}`).join('; ')}. Trang Failover & Incidents đối chiếu trace theo khoảng thời gian từng sự cố.`,
        };
      };
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
        xraySource(),
      ];
    },
  };
}

let defaultService;
const clients = new Map();
const xrayClients = new Map();
// Nạp SDK X-Ray khi cần (có sẵn trong runtime Node.js của Lambda), để test và trang khác không phụ thuộc.
let xraySdk;
const realXray = (region) => ({
  async getTraceSummaries(input) {
    xraySdk ??= await import('@aws-sdk/client-xray');
    if (!xrayClients.has(region)) xrayClients.set(region, new xraySdk.XRayClient({ region }));
    return xrayClients.get(region).send(new xraySdk.GetTraceSummariesCommand(input));
  },
});
const realService = () => {
  defaultService ??= createService({
    config: loadConfig(),
    clientFor: (region) => { if (!clients.has(region)) clients.set(region, new CloudWatchClient({ region })); return clients.get(region); },
    xrayFor: realXray,
  });
  return defaultService;
};

const ROUTE = /\/monitoring\/(snapshot|endpoints|routes|incidents|sources)\/?$/;

// Người không phải admin không nhận số liệu hạ tầng dùng chung: lưu lượng Lambda và API Gateway toàn stage
// gồm request của mọi doanh nghiệp. Trạng thái health check và replication vẫn giữ để hiển thị tình trạng Region.
export const redactSharedInfra = (snapshot) => {
  const hidden = { kind: 'missing', reason: 'unavailable' };
  return {
    ...snapshot,
    regions: snapshot.regions.map((r) => ({
      ...r,
      lambda: { invocations: hidden, errors: hidden, durationAvgMs: hidden },
      apiGateway: { requests: hidden, error4xx: hidden, error5xx: hidden, healthCheckRequests: hidden, proxyRequests: hidden },
    })),
  };
};

export const handleRequest = async (event, service, authorize = authorizeReport, isAdmin = isReportAdmin) => {
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
    const denied = await authorize(event);
    if (denied) return respond(denied.status, { error: denied.error, code: denied.code });
    if (name !== 'snapshot') return respond(200, await service[name](range));
    const [data, admin] = await Promise.all([service.snapshot(range), isAdmin(event)]);
    return respond(200, admin ? data : redactSharedInfra(data));
  } catch (error) {
    console.error('monitoring_error', error?.name, error?.message);
    return respond(error?.status ?? 502, { error: 'upstream_error', detail: error?.name ?? 'Error' });
  }
};

// Lambda truyền context ở đối số thứ hai, không phải service của ứng dụng.
export const handler = async (event, _context) => handleRequest(event, realService());
