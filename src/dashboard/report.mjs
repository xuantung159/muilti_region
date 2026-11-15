// Báo cáo giám sát theo doanh nghiệp, lọc được theo từng API key và Region.
// Nguồn: telemetry do proxy ghi cho mỗi request /proxy (PK = TENANT#<tenantId>), nên doanh nghiệp
// chỉ thấy request của chính mình. Số liệu hạ tầng (health check, Lambda, replication) vẫn ở /monitoring/*.
//
// Hợp đồng response: docs/performance/LATENCY_ANALYSIS.md mục 5.2. Mọi trường mới là additive; trường cũ giữ
// nguyên kiểu và ý nghĩa (kể cả 0 khi rỗng). Percentile: nearest-rank trên mẫu thô gộp, rank = ceil(p/100·n)
// kẹp [1, n]; mẫu nhỏ (n < 20) thì p95 = giá trị lớn nhất, n < 100 thì p99 = giá trị lớn nhất.
// Thống kê toàn hệ thống (`totals`) luôn tính từ mẫu gộp, không lấy trung bình/max của percentile từng Region.
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ERROR_CLASSES, recordErrorClass } from "../shared/errors.mjs";
import { TELEMETRY_TABLE, db, json } from "../shared/lib.mjs";

const MINUTE = 60_000;
// Trùng với monitoring-web/src/domain/range.ts để biểu đồ của dashboard dùng thẳng series.
export const REPORT_RANGES = {
  "1h": { buckets: 60, bucketMs: MINUTE },
  "6h": { buckets: 72, bucketMs: 5 * MINUTE },
  "24h": { buckets: 96, bucketMs: 15 * MINUTE },
  "7d": { buckets: 84, bucketMs: 120 * MINUTE },
};
export const REPORT_REGIONS = ["ap-southeast-1", "ap-northeast-1"];
export const REPORT_SCHEMA_VERSION = 2;
const KEY_ID = /^[a-f0-9]{12}$/;
const MAX_ENDPOINTS = 50;
const MAX_KEYS = 50;
const MAX_ERROR_TYPES = 50;

// Lỗi do chính gateway (cấu hình, crash). Lỗi UPSTREAM_* và 5xx backend trả về là lỗi của backend khách hàng.
// Hai hàm này giữ định nghĩa cũ cho regions[].gatewayErrors/upstreamErrors.
export const isGatewayError = (r) => r.status >= 500 && r.errorType === "GATEWAY_INTERNAL";
export const isUpstreamError = (r) => r.status >= 500 && !isGatewayError(r);

const UPSTREAM_CLASSES = ["upstream_5xx", "timeout", "connection_error"];

// Nearest-rank trên mảng đã sắp tăng dần; null khi rỗng.
export function percentileSorted(sorted, p) {
  if (!sorted.length) return null;
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1];
}
const round = (n, digits = 0) => Math.round(n * 10 ** digits) / 10 ** digits;
const rate = (part, total) => (total ? round((part / total) * 100, 2) : null);
const sortedOf = (values) => [...values].sort((a, b) => a - b);
const mean = (values) => values.reduce((s, v) => s + v, 0) / values.length;

const emptyClassCounts = () => Object.fromEntries(ERROR_CLASSES.map((c) => [c, 0]));
function classCounts(records) {
  const counts = emptyClassCounts();
  for (const r of records) if (r.errorClass) counts[r.errorClass] += 1;
  return counts;
}

// LatencyStats: null ⇔ samples === 0. Mili giây, số nguyên.
export function latencyStats(values) {
  const sorted = sortedOf(values);
  const pick = (p) => {
    const v = percentileSorted(sorted, p);
    return v === null ? null : Math.round(v);
  };
  return {
    samples: sorted.length,
    avgMs: sorted.length ? Math.round(mean(sorted)) : null,
    p50Ms: pick(50),
    p90Ms: pick(90),
    p95Ms: pick(95),
    p99Ms: pick(99),
    maxMs: sorted.length ? Math.round(sorted[sorted.length - 1]) : null,
  };
}

const numbers = (records, field) => records.map((r) => r[field]).filter((v) => typeof v === "number" && Number.isFinite(v) && v >= 0);
function avgP95(values) {
  if (!values.length) return [null, null];
  return [Math.round(mean(values)), Math.round(percentileSorted(sortedOf(values), 95))];
}

// Chỉ item schemaVersion 2 có các trường này; item cũ không góp mẫu nào.
function breakdownOf(records) {
  const gateway = numbers(records, "gatewayMs");
  const upstreamRecords = records.filter((r) => typeof r.upstreamMs === "number" && Number.isFinite(r.upstreamMs) && r.upstreamMs >= 0);
  const upstream = upstreamRecords.map((r) => r.upstreamMs);
  const connect = numbers(records, "upstreamConnectMs");
  const ttfb = numbers(records, "upstreamTtfbMs");
  const [gatewayAvgMs, gatewayP95Ms] = avgP95(gateway);
  const [upstreamAvgMs, upstreamP95Ms] = avgP95(upstream);
  const [upstreamConnectAvgMs, upstreamConnectP95Ms] = avgP95(connect);
  const [upstreamTtfbAvgMs, upstreamTtfbP95Ms] = avgP95(ttfb);
  return {
    samples: gateway.length,
    gatewayAvgMs, gatewayP95Ms,
    upstreamSamples: upstream.length,
    upstreamAvgMs, upstreamP95Ms,
    connectSamples: connect.length,
    upstreamConnectAvgMs, upstreamConnectP95Ms,
    ttfbSamples: ttfb.length,
    upstreamTtfbAvgMs, upstreamTtfbP95Ms,
    reusedConnectionPct: rate(upstreamRecords.filter((r) => r.upstreamReused === true).length, upstreamRecords.length),
    coldStarts: records.filter((r) => r.coldStart === true).length,
  };
}

// TrafficStats của một tập record (đã chuẩn hóa ở buildReport). Mẫu số mọi tỷ lệ là requests.
export function trafficStats(records) {
  const requests = records.length;
  const errorsByClass = classCounts(records);
  const error4xx = errorsByClass.client_4xx + errorsByClass.upstream_4xx;
  const error5xx = errorsByClass.gateway + errorsByClass.upstream_5xx + errorsByClass.timeout + errorsByClass.connection_error;
  const upstreamErrors = UPSTREAM_CLASSES.reduce((s, c) => s + errorsByClass[c], 0);
  return {
    requests,
    success: requests - error4xx - error5xx,
    error4xx,
    error5xx,
    timeout: errorsByClass.timeout,
    errorsByClass,
    successRatePct: rate(requests - error4xx - error5xx, requests),
    errorRatePct: rate(error4xx + error5xx, requests),
    error4xxRatePct: rate(error4xx, requests),
    error5xxRatePct: rate(error5xx, requests),
    gatewayErrorRatePct: rate(errorsByClass.gateway, requests),
    upstreamErrorRatePct: rate(upstreamErrors, requests),
    timeoutRatePct: rate(errorsByClass.timeout, requests),
    latency: latencyStats(records.map((r) => r.latencyMs)),
    latencySuccess: latencyStats(records.filter((r) => r.status < 400).map((r) => r.latencyMs)),
    breakdown: breakdownOf(records),
  };
}

// Trường cũ: giữ nguyên cách tính (0 khi rỗng).
function summarize(records) {
  const requests = records.length;
  const latencies = sortedOf(records.map((r) => r.latencyMs));
  const count = (fn) => records.filter(fn).length;
  const error4xx = count((r) => r.status >= 400 && r.status < 500);
  const error5xx = count((r) => r.status >= 500);
  return {
    requests,
    success: requests - error4xx - error5xx,
    error4xx,
    error5xx,
    gatewayErrors: count(isGatewayError),
    upstreamErrors: count(isUpstreamError),
    latencyAvgMs: requests ? round(mean(latencies)) : 0,
    latencyP95Ms: round(percentileSorted(latencies, 95) ?? 0),
  };
}

function bucketStats(records) {
  const { gatewayErrors, upstreamErrors, ...legacy } = summarize(records);
  const errorsByClass = classCounts(records);
  const sorted = sortedOf(records.map((r) => r.latencyMs));
  return {
    ...legacy,
    hasData: records.length > 0,
    timeout: errorsByClass.timeout,
    gatewayErrors: errorsByClass.gateway,
    upstreamErrors: UPSTREAM_CLASSES.reduce((s, c) => s + errorsByClass[c], 0),
    errorsByClass,
    latency: sorted.length
      ? {
        avgMs: Math.round(mean(sorted)),
        p50Ms: Math.round(percentileSorted(sorted, 50)),
        p95Ms: Math.round(percentileSorted(sorted, 95)),
        p99Ms: Math.round(percentileSorted(sorted, 99)),
      }
      : null,
  };
}

function groupBy(records, keyOf) {
  const groups = new Map();
  for (const r of records) {
    const id = keyOf(r);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(r);
  }
  return groups;
}

export const windowOf = (rangeName, now) => {
  const range = REPORT_RANGES[rangeName];
  const startMs = Math.floor(now / range.bucketMs) * range.bucketMs - (range.buckets - 1) * range.bucketMs;
  return { startMs, endMs: now, bucketMs: range.bucketMs, buckets: range.buckets };
};

// Hàm thuần: gom các bản ghi telemetry thành báo cáo. Bản ghi thiếu trường bắt buộc bị bỏ qua.
// `options.region`: 'all' hoặc mã Region, chỉ áp cho totals, errorsByKey, errorTypes, endpoints, routes.
// `options.keys`: danh sách key của tenant (keyId, name, status) để gắn tên vào errorsByKey.
export function buildReport(items, rangeName, now, keyId = null, options = {}) {
  const region = options.region ?? "all";
  const keys = options.keys ?? [];
  const window = windowOf(rangeName, now);
  const { startMs: start, bucketMs, buckets } = window;
  const records = items
    .map((r) => ({ ...r, t: Date.parse(r.timestamp) }))
    .filter((r) => Number.isFinite(r.t) && r.t >= start && Number.isFinite(r.status) && Number.isFinite(r.latencyMs)
      && REPORT_REGIONS.includes(r.region) && (!keyId || r.keyId === keyId))
    .map((r) => ({ ...r, errorClass: recordErrorClass(r) }));
  const scoped = region === "all" ? records : records.filter((r) => r.region === region);

  // regions[] và series luôn đủ hai Region, chỉ lọc keyId.
  const regions = REPORT_REGIONS.map((code) => {
    const list = records.filter((r) => r.region === code);
    return { region: code, ...summarize(list), stats: trafficStats(list) };
  });

  const cells = Array.from({ length: buckets }, () => Object.fromEntries(REPORT_REGIONS.map((code) => [code, []])));
  for (const r of records) {
    const index = Math.floor((r.t - start) / bucketMs);
    if (index >= 0 && index < buckets) cells[index][r.region].push(r);
  }
  const series = cells.map((cell, i) => {
    const t = start + i * bucketMs;
    return {
      t,
      partial: now >= t && now < t + bucketMs,
      regions: Object.fromEntries(REPORT_REGIONS.map((code) => [code, bucketStats(cell[code])])),
    };
  });

  const endpoints = [...groupBy(scoped, (r) => `${r.method ?? "ANY"} ${r.path ?? "/"} ${r.region} ${r.apiId ?? ""}`).values()].map((list) => {
    const s = summarize(list);
    const errorsByClass = classCounts(list);
    const sorted = sortedOf(list.map((r) => r.latencyMs));
    const { method, path, region: served, apiId } = list[0];
    return {
      method: ["GET", "POST", "PUT", "DELETE"].includes(method) ? method : "ANY",
      path: path ?? "/", region: served, apiId: apiId ?? "",
      requests: s.requests,
      successRatePct: round((s.success / s.requests) * 100, 2),
      errorRatePct: round(((s.error4xx + s.error5xx) / s.requests) * 100, 2),
      serverErrorRatePct: round((s.error5xx / s.requests) * 100, 2),
      gatewayErrorRatePct: round((s.gatewayErrors / s.requests) * 100, 2),
      latencyAvgMs: s.latencyAvgMs,
      latencyP95Ms: s.latencyP95Ms,
      lastUpdated: Math.max(...list.map((r) => r.t)),
      error4xxRatePct: round((s.error4xx / s.requests) * 100, 2),
      timeoutRatePct: round((errorsByClass.timeout / s.requests) * 100, 2),
      errorsByClass,
      latencyP50Ms: Math.round(percentileSorted(sorted, 50)),
      latencyP99Ms: Math.round(percentileSorted(sorted, 99)),
    };
  }).sort((a, b) => b.requests - a.requests).slice(0, MAX_ENDPOINTS);

  const routeMap = new Map();
  for (const r of scoped) {
    const country = /^[A-Z]{2}$/.test(r.country ?? "") ? r.country : "ZZ";
    const id = `${country}|${r.region}`;
    const current = routeMap.get(id) ?? { country, servedRegion: r.region, requests: 0, lastSeen: 0 };
    current.requests += 1;
    current.lastSeen = Math.max(current.lastSeen, r.t);
    routeMap.set(id, current);
  }
  const routes = [...routeMap.values()].sort((a, b) => b.requests - a.requests);

  const keyInfo = new Map(keys.map((k) => [k.keyId, k]));
  const errorsByKey = [...groupBy(scoped.filter((r) => typeof r.keyId === "string" && r.keyId), (r) => r.keyId).entries()]
    .map(([id, list]) => {
      const s = trafficStats(list);
      const info = keyInfo.get(id);
      return {
        keyId: id,
        name: typeof info?.name === "string" ? info.name : null,
        status: info?.status === "active" || info?.status === "revoked" ? info.status : null,
        requests: s.requests,
        error4xx: s.error4xx,
        error5xx: s.error5xx,
        timeout: s.timeout,
        errorsByClass: s.errorsByClass,
        errorRatePct: s.errorRatePct,
      };
    })
    .sort((a, b) => (b.error4xx + b.error5xx) - (a.error4xx + a.error5xx) || b.requests - a.requests || (a.keyId < b.keyId ? -1 : a.keyId > b.keyId ? 1 : 0))
    .slice(0, MAX_KEYS);

  const typeMap = new Map();
  for (const r of scoped) {
    if (!r.errorClass) continue;
    const errorType = typeof r.errorType === "string" && r.errorType ? r.errorType : null;
    const id = `${r.errorClass}|${errorType ?? ""}|${r.status}|${r.region}`;
    const current = typeMap.get(id) ?? { errorClass: r.errorClass, errorType, status: r.status, region: r.region, count: 0, lastSeen: 0 };
    current.count += 1;
    current.lastSeen = Math.max(current.lastSeen, r.t);
    typeMap.set(id, current);
  }
  const errorTypes = [...typeMap.values()].sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen).slice(0, MAX_ERROR_TYPES);

  return {
    range: rangeName, keyId, generatedAt: now, source: "telemetry", regions, series, endpoints, routes,
    schemaVersion: REPORT_SCHEMA_VERSION,
    filters: { range: rangeName, keyId, region },
    window,
    totals: trafficStats(scoped),
    errorsByKey,
    errorTypes,
  };
}

export async function report(session, event, keys, now = Date.now()) {
  if (!TELEMETRY_TABLE) return json(503, { error: "Chưa cấu hình TELEMETRY_TABLE cho dashboard" });
  const params = event.queryStringParameters ?? {};
  const rangeName = params.range ?? "24h";
  if (!REPORT_RANGES[rangeName]) return json(400, { error: "range phải là 1h, 6h, 24h hoặc 7d" });
  const region = params.region ?? "all";
  if (region !== "all" && !REPORT_REGIONS.includes(region)) {
    return json(400, { error: "region phải là all, ap-southeast-1 hoặc ap-northeast-1" });
  }
  const keyId = !params.keyId || params.keyId === "all" ? null : params.keyId;
  // Key phải thuộc doanh nghiệp đang đăng nhập; không lộ việc key của doanh nghiệp khác có tồn tại hay không.
  if (keyId && (!KEY_ID.test(keyId) || !keys.some((k) => k.keyId === keyId))) return json(404, { error: "Không tìm thấy API key" });

  const from = new Date(windowOf(rangeName, now).startMs).toISOString();
  const items = [];
  let ExclusiveStartKey;
  do {
    const res = await db.send(new QueryCommand({
      TableName: TELEMETRY_TABLE,
      KeyConditionExpression: "PK = :pk AND SK BETWEEN :from AND :to",
      ExpressionAttributeValues: { ":pk": `TENANT#${session.tenantId}`, ":from": from, ":to": `${new Date(now).toISOString()}#~` },
      ProjectionExpression: "#ts, #st, latencyMs, #rg, keyId, apiId, #m, #p, country, errorType, "
        + "errorClass, errorCause, gatewayMs, upstreamMs, upstreamConnectMs, upstreamTtfbMs, upstreamStatus, upstreamReused, coldStart",
      ExpressionAttributeNames: { "#ts": "timestamp", "#st": "status", "#rg": "region", "#m": "method", "#p": "path" },
      ExclusiveStartKey,
    }));
    items.push(...(res.Items ?? []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  const publicKeys = keys.map(({ keyId: id, name, status }) => ({ keyId: id, name, status }));
  const body = buildReport(items, rangeName, now, keyId, { region, keys: publicKeys });
  body.keys = publicKeys;
  return json(200, body);
}
