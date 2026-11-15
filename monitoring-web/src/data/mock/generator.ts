// Bộ sinh dữ liệu mẫu. Giá trị được suy ra từ thời điểm của ô thời gian nên ổn định giữa các lần refresh
// và tự dịch chuyển theo đồng hồ. Đây là số liệu minh họa, không phản ánh hệ thống AWS nào.
import { RANGES } from '../../domain/range';
import { statsFields } from '../report';
import {
  type BucketStats,
  ERROR_CLASSES,
  type ErrorClass,
  type ErrorClassCounts,
  type ErrorTypeStat,
  type KeyErrorStat,
  type LatencyStats,
  type RegionFilter,
  type TenantReportExtras,
  type TrafficStats,
  type EndpointStat,
  type HttpMethod,
  type IncidentEvent,
  type MonitoringSnapshot,
  type RangeKey,
  type RegionCode,
  type RegionSnapshot,
  type SeriesPoint,
  missing,
  REGIONS,
  value,
} from '../../domain/types';

const MINUTE = 60_000;
const SG = 'ap-southeast-1' as const;
const TYO = 'ap-northeast-1' as const;

const PROFILE: Record<RegionCode, { requestsPerMinute: number; latencyMs: number; replicationMs: number }> = {
  [SG]: { requestsPerMinute: 180, latencyMs: 48, replicationMs: 850 },
  [TYO]: { requestsPerMinute: 130, latencyMs: 56, replicationMs: 910 },
};

// Nhiễu tất định trong [-1, 1] theo (seed, thời điểm).
export function noise(seed: string, t: number): number {
  const s = `${seed}:${t}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

// Một sự cố mô phỏng ở Tokyo, luôn nằm cách hiện tại khoảng 2 đến 2,5 giờ để nhìn thấy ở khoảng xem 6 giờ trở lên.
export function simulatedIncidentWindow(now: number): { start: number; end: number } {
  const anchor = Math.floor(now / (5 * MINUTE)) * 5 * MINUTE;
  return { start: anchor - 150 * MINUTE, end: anchor - 120 * MINUTE };
}

function overlapFraction(t: number, bucketMs: number, window: { start: number; end: number }): number {
  const overlap = Math.min(t + bucketMs, window.end) - Math.max(t, window.start);
  return Math.max(0, overlap) / bucketMs;
}

function bucketStats(region: RegionCode, t: number, bucketMs: number, incident: { start: number; end: number }): BucketStats {
  const profile = PROFILE[region];
  const hour = (t / 3_600_000 + 7) % 24; // giờ Việt Nam
  const diurnal = 1 + 0.35 * Math.sin(((hour - 8) / 24) * 2 * Math.PI);
  const hit = overlapFraction(t, bucketMs, incident);
  const loadShift = region === TYO ? 1 - 0.65 * hit : 1 + 0.5 * hit;

  const requests = Math.round(profile.requestsPerMinute * (bucketMs / MINUTE) * diurnal * (1 + 0.1 * noise(`${region}-req`, t)) * loadShift);
  const rate4xx = 0.012 * (1 + 0.4 * noise(`${region}-4xx`, t));
  const rate5xx = 0.0025 * (1 + 0.5 * noise(`${region}-5xx`, t)) + (region === TYO ? 0.18 * hit : 0);
  const error4xx = Math.round(requests * rate4xx);
  const error5xx = Math.round(requests * rate5xx);
  const latencyAvgMs = profile.latencyMs * (1 + 0.08 * noise(`${region}-lat`, t)) * (1 + (region === TYO ? 2 : 0.15) * hit);
  const latencyP95Ms = latencyAvgMs * 2.4 * (1 + 0.06 * noise(`${region}-p95`, t));
  const errorsByClass = splitErrors(error4xx, error5xx, region === TYO ? hit : 0);

  return {
    requests,
    success: requests - error4xx - error5xx,
    error4xx,
    error5xx,
    latencyAvgMs,
    latencyP95Ms,
    // Trường schemaVersion 2 (mô phỏng).
    hasData: requests > 0,
    timeout: errorsByClass.timeout,
    gatewayErrors: errorsByClass.gateway,
    upstreamErrors: errorsByClass.upstream_5xx + errorsByClass.timeout + errorsByClass.connection_error,
    errorsByClass,
    latency:
      requests > 0
        ? { avgMs: Math.round(latencyAvgMs), p50Ms: Math.round(latencyAvgMs * 0.85), p95Ms: Math.round(latencyP95Ms), p99Ms: Math.round(latencyP95Ms * 1.5) }
        : null,
  };
}

// Chia 4xx/5xx mẫu theo errorClass, giữ bất biến 4xx = client_4xx + upstream_4xx, 5xx = gateway + upstream_5xx + timeout + connection_error.
// Trong sự cố mô phỏng, phần lớn 5xx là timeout.
function splitErrors(error4xx: number, error5xx: number, incident: number): ErrorClassCounts {
  const client = Math.floor(error4xx * 0.4);
  const timeout = Math.floor(error5xx * (0.25 + 0.5 * incident));
  const connection = Math.floor(error5xx * 0.1);
  const gateway = Math.floor(error5xx * 0.05);
  return {
    client_4xx: client,
    upstream_4xx: error4xx - client,
    gateway,
    upstream_5xx: error5xx - timeout - connection - gateway,
    timeout,
    connection_error: connection,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const rate = (part: number, total: number) => (total > 0 ? round2((part / total) * 100) : null);
const zeroClasses = (): ErrorClassCounts => Object.fromEntries(ERROR_CLASSES.map((c) => [c, 0])) as ErrorClassCounts;
const addClasses = (a: ErrorClassCounts, b: ErrorClassCounts): ErrorClassCounts =>
  Object.fromEntries(ERROR_CLASSES.map((c) => [c, a[c] + b[c]])) as ErrorClassCounts;

function latencyStats(samples: number, avg: number, p95: number): LatencyStats {
  if (samples === 0) return { samples: 0, avgMs: null, p50Ms: null, p90Ms: null, p95Ms: null, p99Ms: null, maxMs: null };
  return {
    samples,
    avgMs: Math.round(avg),
    p50Ms: Math.round(avg * 0.85),
    p90Ms: Math.round(p95 * 0.8),
    p95Ms: Math.round(p95),
    p99Ms: Math.round(p95 * 1.5),
    maxMs: Math.round(p95 * 2.2),
  };
}

// TrafficStats mô phỏng từ các ô. Percentile mẫu là trung bình có trọng số của ô (bộ sinh không có mẫu thô),
// chỉ để minh họa giao diện.
function trafficStats(rows: BucketStats[], seed: string): TrafficStats {
  const sum = (pick: (b: BucketStats) => number) => rows.reduce((s, b) => s + pick(b), 0);
  const requests = sum((b) => b.requests);
  const error4xx = sum((b) => b.error4xx);
  const error5xx = sum((b) => b.error5xx);
  const errorsByClass = rows.reduce((acc, b) => addClasses(acc, b.errorsByClass ?? zeroClasses()), zeroClasses());
  const weighted = (pick: (b: BucketStats) => number) => sum((b) => pick(b) * b.requests) / Math.max(1, requests);
  const avg = weighted((b) => b.latencyAvgMs);
  const p95 = weighted((b) => b.latencyP95Ms);
  const upstreamSamples = requests - errorsByClass.client_4xx; // client_4xx dừng ở gateway, không gọi backend
  const gatewayAvg = 14 * (1 + 0.1 * noise(`${seed}-gw`, requests));
  const connectSamples = Math.round(upstreamSamples * 0.08);
  const ttfbSamples = upstreamSamples - errorsByClass.timeout - errorsByClass.connection_error;
  const none = requests === 0;
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
    upstreamErrorRatePct: rate(errorsByClass.upstream_5xx + errorsByClass.timeout + errorsByClass.connection_error, requests),
    timeoutRatePct: rate(errorsByClass.timeout, requests),
    latency: latencyStats(requests, avg, p95),
    latencySuccess: latencyStats(requests - error4xx - error5xx, avg * 0.95, p95 * 0.9),
    breakdown: {
      samples: requests,
      gatewayAvgMs: none ? null : Math.round(gatewayAvg),
      gatewayP95Ms: none ? null : Math.round(gatewayAvg * 2.5),
      upstreamSamples,
      upstreamAvgMs: upstreamSamples ? Math.round(Math.max(0, avg - gatewayAvg)) : null,
      upstreamP95Ms: upstreamSamples ? Math.round(Math.max(0, p95 - gatewayAvg * 2.5)) : null,
      connectSamples,
      upstreamConnectAvgMs: connectSamples ? Math.round(avg * 0.6) : null,
      upstreamConnectP95Ms: connectSamples ? Math.round(p95 * 0.7) : null,
      ttfbSamples,
      upstreamTtfbAvgMs: ttfbSamples ? Math.round(Math.max(0, avg - gatewayAvg) * 0.9) : null,
      upstreamTtfbP95Ms: ttfbSamples ? Math.round(Math.max(0, p95 - gatewayAvg * 2.5) * 0.9) : null,
      reusedConnectionPct: upstreamSamples ? 92 : null,
      coldStarts: Math.min(requests, 3),
    },
  };
}

const ERROR_TYPE: Record<ErrorClass, { errorType: string | null; status: number }> = {
  client_4xx: { errorType: 'API_NOT_FOUND', status: 404 },
  upstream_4xx: { errorType: null, status: 404 },
  gateway: { errorType: 'GATEWAY_INTERNAL', status: 500 },
  upstream_5xx: { errorType: 'UPSTREAM_5XX', status: 503 },
  timeout: { errorType: 'UPSTREAM_TIMEOUT', status: 504 },
  connection_error: { errorType: 'UPSTREAM_UNREACHABLE', status: 502 },
};

// Key mẫu: tên ghi rõ là mẫu để không nhầm với key thật của doanh nghiệp.
const MOCK_KEYS: { keyId: string; name: string; status: 'active' | 'revoked'; share: number }[] = [
  { keyId: '00000000a001', name: 'Key mẫu: web', status: 'active', share: 0.6 },
  { keyId: '00000000a002', name: 'Key mẫu: mobile', status: 'active', share: 0.3 },
  { keyId: '00000000a003', name: 'Key mẫu: batch', status: 'revoked', share: 0.1 },
];

function buildExtras(series: SeriesPoint[], range: RangeKey, now: number, region: RegionFilter): TenantReportExtras {
  const codes = REGIONS.map((r) => r.code).filter((c) => region === 'all' || c === region);
  const rows = series.flatMap((p) => codes.map((c) => p.regions[c]));
  const totals = trafficStats(rows, `totals-${region}`);

  const errorsByKey: KeyErrorStat[] = MOCK_KEYS.map((k, i) => {
    // Key đầu nhận phần dư để tổng các key đúng bằng totals.
    const take = (n: number) => (i === 0 ? n - MOCK_KEYS.slice(1).reduce((s, x) => s + Math.floor(n * x.share), 0) : Math.floor(n * k.share));
    const errorsByClass = Object.fromEntries(ERROR_CLASSES.map((c) => [c, take(totals.errorsByClass[c])])) as ErrorClassCounts;
    const requests = take(totals.requests);
    const error4xx = errorsByClass.client_4xx + errorsByClass.upstream_4xx;
    const error5xx = errorsByClass.gateway + errorsByClass.upstream_5xx + errorsByClass.timeout + errorsByClass.connection_error;
    return { keyId: k.keyId, name: k.name, status: k.status, requests, error4xx, error5xx, timeout: errorsByClass.timeout, errorsByClass, errorRatePct: rate(error4xx + error5xx, requests) };
  })
    .filter((k) => k.requests > 0)
    .sort((a, b) => b.error4xx + b.error5xx - (a.error4xx + a.error5xx) || b.requests - a.requests || a.keyId.localeCompare(b.keyId));

  const errorTypes: ErrorTypeStat[] = codes
    .flatMap((code) =>
      ERROR_CLASSES.map((errorClass) => {
        const hits = series.filter((p) => (p.regions[code].errorsByClass?.[errorClass] ?? 0) > 0);
        const count = hits.reduce((s, p) => s + (p.regions[code].errorsByClass?.[errorClass] ?? 0), 0);
        return { errorClass, ...ERROR_TYPE[errorClass], region: code, count, lastSeen: hits.at(-1)?.t ?? now };
      }),
    )
    .filter((e) => e.count > 0)
    .sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen)
    .slice(0, 50);

  const { buckets, bucketMs } = RANGES[range];
  return {
    schemaVersion: 2,
    filters: { range, keyId: null, region },
    window: { startMs: series[0]?.t ?? now, endMs: now, bucketMs, buckets },
    totals,
    errorsByKey,
    errorTypes,
  };
}

function buildSeries(range: RangeKey, now: number): SeriesPoint[] {
  const { buckets, bucketMs } = RANGES[range];
  const end = Math.floor(now / bucketMs) * bucketMs;
  const incident = simulatedIncidentWindow(now);
  return Array.from({ length: buckets }, (_, i) => {
    const t = end - (buckets - i) * bucketMs;
    // Ô cuối kết thúc trước thời điểm hiện tại nên luôn đủ thời gian: partial = false.
    return { t, partial: false, regions: { [SG]: bucketStats(SG, t, bucketMs, incident), [TYO]: bucketStats(TYO, t, bucketMs, incident) } };
  });
}

function summarise(region: RegionCode, series: SeriesPoint[], sharePct: number, now: number): RegionSnapshot {
  const rows = series.map((p) => p.regions[region]);
  const sum = (pick: (b: BucketStats) => number) => rows.reduce((s, b) => s + pick(b), 0);
  const requests = sum((b) => b.requests);
  const error4xx = sum((b) => b.error4xx);
  const error5xx = sum((b) => b.error5xx);
  const weighted = (pick: (b: BucketStats) => number) => sum((b) => pick(b) * b.requests) / Math.max(1, requests);
  const latencyAvg = weighted((b) => b.latencyAvgMs);

  return {
    region,
    healthCheck: value('healthy'),
    trafficSharePct: value(sharePct),
    requests: value(requests),
    successRatePct: value(((requests - error4xx - error5xx) / Math.max(1, requests)) * 100),
    errorRatePct: value(((error4xx + error5xx) / Math.max(1, requests)) * 100),
    serverErrorRatePct: value((error5xx / Math.max(1, requests)) * 100),
    latencyAvgMs: value(latencyAvg),
    latencyP95Ms: value(weighted((b) => b.latencyP95Ms)),
    lambda: {
      invocations: value(requests),
      errors: value(Math.round(error5xx * 0.8)),
      durationAvgMs: value(latencyAvg * 0.7),
    },
    // Mẫu: stage = /proxy + health check (~2 điểm kiểm tra/phút × 16 điểm) + một ít portal/dashboard.
    apiGateway: (() => {
      const health = Math.round((series.length * (series[1] ? series[1].t - series[0].t : MINUTE)) / 30_000) * 16;
      const total = requests + health + Math.round(requests * 0.05);
      return { requests: value(total), error4xx: value(error4xx), error5xx: value(error5xx), healthCheckRequests: value(health), proxyRequests: value(requests) };
    })(),
    ...statsFields(trafficStats(rows, region)),
    dynamodbReplicationObservedAt: now,
    dynamodbReplicationLatencyMs: value(PROFILE[region].replicationMs * (1 + 0.1 * noise(`${region}-repl`, Math.floor(now / MINUTE)))),
    // Cố ý để trống: minh họa trạng thái "Not configured" khi replication metrics của S3 chưa bật.
    s3ReplicationLatencyS: missing('not_configured'),
  };
}

export function buildSnapshot(range: RangeKey, now: number, region: RegionFilter = 'all'): MonitoringSnapshot {
  const series = buildSeries(range, now);
  const last = series[series.length - 1].regions;
  const lastTotal = Math.max(1, last[SG].requests + last[TYO].requests);
  return {
    dataMode: 'mock',
    generatedAt: now,
    range,
    routingPolicy: value('Latency-based + health check'),
    regions: REGIONS.map((r) => summarise(r.code, series, (last[r.code].requests / lastTotal) * 100, now)),
    series,
    report: buildExtras(series, range, now, region),
  };
}

// Endpoint minh họa cho đến khi cấu hình API thật được xác nhận.
const ENDPOINTS: { method: HttpMethod; path: string; weight: number; errorPct: Record<RegionCode, number>; latencyFactor: number }[] = [
  { method: 'GET', path: '/health', weight: 0.3, errorPct: { [SG]: 0, [TYO]: 0 }, latencyFactor: 0.3 },
  { method: 'POST', path: '/tenants', weight: 0.02, errorPct: { [SG]: 2.1, [TYO]: 1.8 }, latencyFactor: 1.9 },
  { method: 'POST', path: '/orders', weight: 0.22, errorPct: { [SG]: 0.9, [TYO]: 3.4 }, latencyFactor: 1.6 },
  { method: 'GET', path: '/orders', weight: 0.31, errorPct: { [SG]: 0.6, [TYO]: 0.7 }, latencyFactor: 1.1 },
  { method: 'GET', path: '/orders/{orderId}', weight: 0.1, errorPct: { [SG]: 0.8, [TYO]: 0.9 }, latencyFactor: 0.8 },
  { method: 'GET', path: '/usage', weight: 0.05, errorPct: { [SG]: 0.4, [TYO]: 6.2 }, latencyFactor: 2.2 },
];

export function buildEndpoints(range: RangeKey, now: number): EndpointStat[] {
  const snapshot = buildSnapshot(range, now);
  return snapshot.regions.flatMap((r) => {
    const total = r.requests.kind === 'value' ? r.requests.value : 0;
    return ENDPOINTS.map((e) => ({
      method: e.method,
      path: e.path,
      region: r.region,
      requests: Math.round(total * e.weight),
      successRatePct: 100 - e.errorPct[r.region],
      errorRatePct: e.errorPct[r.region],
      serverErrorRatePct: e.errorPct[r.region],
      latencyAvgMs: PROFILE[r.region].latencyMs * e.latencyFactor,
      latencyP50Ms: PROFILE[r.region].latencyMs * e.latencyFactor * 0.85,
      latencyP99Ms: PROFILE[r.region].latencyMs * e.latencyFactor * 3.6,
      error4xxRatePct: 0,
      timeoutRatePct: round2(e.errorPct[r.region] * 0.3),
      lastUpdated: now,
    }));
  });
}

export function buildIncidents(now: number): IncidentEvent[] {
  const { start, end } = simulatedIncidentWindow(now);
  const testStart = start - 26 * 60 * MINUTE;
  return [
    {
      id: 'sim-shift-back',
      kind: 'traffic_shift',
      origin: 'simulated',
      region: TYO,
      title: 'Traffic quay lại Tokyo',
      description: 'Tỷ lệ request của Tokyo trở về mức trước sự cố trong dữ liệu mẫu.',
      startedAt: end + 3 * MINUTE,
      endedAt: null,
      recoverySeconds: null,
      evidence: [{ label: 'Nguồn', detail: 'Bộ sinh dữ liệu mẫu trong trình duyệt. Không có bản ghi Route 53 nào được đọc.' }],
    },
    {
      id: 'sim-incident',
      kind: 'incident',
      origin: 'simulated',
      region: TYO,
      title: 'Tỷ lệ lỗi 5xx tăng tại Tokyo',
      description: 'Trong dữ liệu mẫu, khoảng 18% request tại ap-northeast-1 trả 5xx và latency tăng gấp ba trong 30 phút.',
      startedAt: start,
      endedAt: end,
      recoverySeconds: (end - start) / 1000,
      evidence: [
        { label: 'Biểu đồ', detail: 'Xem System Overview với khoảng thời gian 6 giờ: cột lỗi tăng trong cùng khung giờ.' },
        { label: 'Nguồn', detail: 'Bộ sinh dữ liệu mẫu trong trình duyệt. Không phải CloudWatch.' },
      ],
    },
    {
      id: 'sim-shift-away',
      kind: 'traffic_shift',
      origin: 'simulated',
      region: TYO,
      title: 'Traffic chuyển sang Singapore',
      description: 'Request của Tokyo giảm khoảng 65%, request của Singapore tăng khoảng 50% trong dữ liệu mẫu.',
      startedAt: start + 2 * MINUTE,
      endedAt: end,
      recoverySeconds: null,
      evidence: [{ label: 'Nguồn', detail: 'Bộ sinh dữ liệu mẫu trong trình duyệt. Chưa chứng minh Route 53 đã chuyển hướng.' }],
    },
    {
      id: 'sim-failover-test',
      kind: 'failover_test',
      origin: 'simulated',
      region: SG,
      title: 'Kiểm thử failover: Singapore báo unhealthy',
      description: 'Bản ghi minh họa cách một kết quả kiểm thử sẽ hiển thị. Thời gian phục hồi là giá trị giả định, chưa đo.',
      startedAt: testStart,
      endedAt: testStart + 4 * MINUTE,
      recoverySeconds: 142,
      evidence: [
        { label: 'Kịch bản', detail: 'Cho /health trả 503 tại ap-southeast-1, theo dõi header x-served-region của các request tiếp theo.' },
        { label: 'Nguồn', detail: 'Dữ liệu mẫu. Kết quả đo thật sẽ được ghi với nhãn Manual test.' },
      ],
    },
  ];
}
