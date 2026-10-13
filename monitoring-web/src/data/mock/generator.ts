// Bộ sinh dữ liệu mẫu. Giá trị được suy ra từ thời điểm của ô thời gian nên ổn định giữa các lần refresh
// và tự dịch chuyển theo đồng hồ. Đây là số liệu minh họa, không phản ánh hệ thống AWS nào.
import { RANGES } from '../../domain/range';
import {
  type BucketStats,
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

  return {
    requests,
    success: requests - error4xx - error5xx,
    error4xx,
    error5xx,
    latencyAvgMs,
    latencyP95Ms: latencyAvgMs * 2.4 * (1 + 0.06 * noise(`${region}-p95`, t)),
  };
}

function buildSeries(range: RangeKey, now: number): SeriesPoint[] {
  const { buckets, bucketMs } = RANGES[range];
  const end = Math.floor(now / bucketMs) * bucketMs;
  const incident = simulatedIncidentWindow(now);
  return Array.from({ length: buckets }, (_, i) => {
    const t = end - (buckets - i) * bucketMs;
    return { t, regions: { [SG]: bucketStats(SG, t, bucketMs, incident), [TYO]: bucketStats(TYO, t, bucketMs, incident) } };
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
    latencyAvgMs: value(latencyAvg),
    latencyP95Ms: value(weighted((b) => b.latencyP95Ms)),
    lambda: {
      invocations: value(requests),
      errors: value(Math.round(error5xx * 0.8)),
      durationAvgMs: value(latencyAvg * 0.7),
    },
    apiGateway: { requests: value(requests), error4xx: value(error4xx), error5xx: value(error5xx) },
    dynamodbReplicationLatencyMs: value(PROFILE[region].replicationMs * (1 + 0.1 * noise(`${region}-repl`, Math.floor(now / MINUTE)))),
    // Cố ý để trống: minh họa trạng thái "Not configured" khi replication metrics của S3 chưa bật.
    s3ReplicationLatencyS: missing('not_configured'),
  };
}

export function buildSnapshot(range: RangeKey, now: number): MonitoringSnapshot {
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
      latencyAvgMs: PROFILE[r.region].latencyMs * e.latencyFactor,
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
