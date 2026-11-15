import { describe, expect, it } from 'vitest';
import { NotConnectedProvider } from '../data/providers';
import { errorRatePoint, errorSplitRow, latencyComponents, latencyPoint, overviewTotals, partialTimes, requestPoint, seriesHasTimeout, timeoutPoint } from './report';
import type { BucketStats, LatencyBreakdown, LatencyStats, Metric, MonitoringSnapshot, SeriesPoint, TrafficStats } from './types';

const v = (n: number): Metric => ({ kind: 'value', value: n });
const stats = (over: Partial<LatencyStats> = {}): LatencyStats => ({ samples: 10, avgMs: 100, p50Ms: 80, p90Ms: 200, p95Ms: 250, p99Ms: 400, maxMs: 500, ...over });
const emptyBreakdown: LatencyBreakdown = {
  samples: 0, gatewayAvgMs: null, gatewayP95Ms: null, upstreamSamples: 0, upstreamAvgMs: null, upstreamP95Ms: null,
  connectSamples: 0, upstreamConnectAvgMs: null, upstreamConnectP95Ms: null, ttfbSamples: 0, upstreamTtfbAvgMs: null, upstreamTtfbP95Ms: null,
  reusedConnectionPct: null, coldStarts: 0,
};
const classes = { client_4xx: 0, upstream_4xx: 0, gateway: 0, upstream_5xx: 0, timeout: 0, connection_error: 0 };
const totals = (over: Partial<TrafficStats> = {}): TrafficStats => ({
  requests: 744, success: 604, error4xx: 100, error5xx: 40, timeout: 5, errorsByClass: classes,
  successRatePct: 81.18, errorRatePct: 18.82, error4xxRatePct: 13.44, error5xxRatePct: 5.38, gatewayErrorRatePct: 0, upstreamErrorRatePct: 5.38, timeoutRatePct: 0.67,
  latency: stats({ p95Ms: 702, p99Ms: 1500 }), latencySuccess: stats(), breakdown: emptyBreakdown, ...over,
});

// Hai Region giống tình huống trong audit: SG p95 702 ms, Tokyo p95 1040 ms.
async function twoRegions(): Promise<MonitoringSnapshot> {
  const base = await new NotConnectedProvider().getSnapshot('7d');
  const [sg, tyo] = base.regions;
  return {
    ...base,
    regions: [
      { ...sg, requests: v(524), successRatePct: v(77.67), errorRatePct: v(22.33), latencyAvgMs: v(300), latencyP95Ms: v(702) },
      { ...tyo, requests: v(220), successRatePct: v(89.55), errorRatePct: v(10.45), latencyAvgMs: v(232), latencyP95Ms: v(1040) },
    ],
  };
}

describe('overviewTotals: p95 toàn hệ thống', () => {
  it('dùng p95 gộp từ report.totals khi backend có, không lấy max p95 các Region', async () => {
    const snapshot = { ...(await twoRegions()), report: { totals: totals() } };
    const kpi = overviewTotals(snapshot);
    expect(kpi.pooled).toBe(true);
    expect(kpi.p95).toEqual({ metric: v(702), upperBound: false });
    expect(kpi.p99).toEqual({ metric: v(1500), upperBound: false });
    expect(kpi.requests).toEqual(v(744));
    expect(kpi.errorPct).toEqual(v(18.82));
  });

  it('backend cũ: chỉ có cận trên (max p95 các Region) và gắn cờ upperBound', async () => {
    const kpi = overviewTotals(await twoRegions());
    expect(kpi.pooled).toBe(false);
    expect(kpi.p95).toEqual({ metric: v(1040), upperBound: true });
    expect(kpi.p99).toBeNull(); // không có p99 nào → N/A, không bịa
    expect(kpi.requests).toEqual(v(744));
  });

  it('backend cũ + lọc một Region: p95 của Region đó là p95 thật, không phải cận trên', async () => {
    const kpi = overviewTotals(await twoRegions(), 'ap-southeast-1');
    expect(kpi.p95).toEqual({ metric: v(702), upperBound: false });
    expect(kpi.requests).toEqual(v(524));
  });

  it('totals không có mẫu: null → missing, không thành 0', async () => {
    const empty = totals({ requests: 0, successRatePct: null, errorRatePct: null, latency: stats({ samples: 0, avgMs: null, p95Ms: null, p99Ms: null }) });
    const kpi = overviewTotals({ ...(await twoRegions()), report: { totals: empty } });
    expect(kpi.requests).toEqual(v(0));
    expect(kpi.p95.metric.kind).toBe('missing');
    expect(kpi.avgMs.kind).toBe('missing');
    expect(kpi.successPct.kind).toBe('missing');
  });
});

const bucket = (over: Partial<BucketStats> = {}): BucketStats => ({ requests: 10, success: 9, error4xx: 1, error5xx: 0, latencyAvgMs: 50, latencyP95Ms: 120, ...over });

describe('điểm biểu đồ: khoảng trống thay vì 0', () => {
  it('latency null (ô rỗng) và ô thiếu → null; có latency mới thì dùng latency mới', () => {
    expect(latencyPoint(bucket({ requests: 0, latency: null, hasData: false, latencyAvgMs: 0, latencyP95Ms: 0 }), 'p95')).toBeNull();
    expect(latencyPoint(undefined, 'avg')).toBeNull();
    expect(latencyPoint(bucket({ latency: { avgMs: 60, p50Ms: 40, p95Ms: 130, p99Ms: 300 } }), 'p95')).toBe(130);
    expect(latencyPoint(bucket({ latency: { avgMs: 60, p50Ms: 40, p95Ms: 130, p99Ms: 300 } }), 'p99')).toBe(300);
  });

  it('backend cũ trả latency 0 cho ô không có request → coi là không có dữ liệu', () => {
    expect(latencyPoint(bucket({ requests: 0, success: 0, error4xx: 0, latencyAvgMs: 0, latencyP95Ms: 0 }), 'p95')).toBeNull();
    expect(latencyPoint(bucket(), 'p95')).toBe(120);
    expect(latencyPoint(bucket(), 'p99')).toBeNull();
  });

  it('số request 0 là 0 thật; chỉ ô thiếu hẳn mới là khoảng trống', () => {
    expect(requestPoint(bucket({ requests: 0, hasData: false }))).toBe(0);
    expect(requestPoint(undefined)).toBeNull();
  });

  it('error rate của ô không có request là khoảng trống, không phải 0%', () => {
    expect(errorRatePoint(bucket({ requests: 0, success: 0, error4xx: 0 }))).toBeNull();
    expect(errorRatePoint(bucket())).toBe(10);
  });

  it('timeout: backend cũ không có trường → null; ô partial được đánh dấu', () => {
    const series: SeriesPoint[] = [
      { t: 1, regions: { 'ap-southeast-1': bucket(), 'ap-northeast-1': bucket() } },
      { t: 2, partial: true, regions: { 'ap-southeast-1': bucket({ timeout: 0 }), 'ap-northeast-1': bucket({ timeout: 2 }) } },
    ];
    expect(timeoutPoint(series[0].regions['ap-southeast-1'])).toBeNull();
    expect(timeoutPoint(series[1].regions['ap-southeast-1'])).toBe(0);
    expect(seriesHasTimeout(series)).toBe(true);
    expect(seriesHasTimeout(series.slice(0, 1))).toBe(false);
    expect(partialTimes(series)).toEqual([2]);
  });

  it('tách timeout khỏi 5xx khi có trường timeout', () => {
    const p: SeriesPoint = { t: 5, regions: { 'ap-southeast-1': bucket({ error5xx: 4, timeout: 3 }), 'ap-northeast-1': bucket({ error5xx: 1, timeout: 0 }) } };
    expect(errorSplitRow(p, ['ap-southeast-1', 'ap-northeast-1'], true)).toEqual({ t: 5, error4xx: 2, error5xx: 2, timeout: 3 });
    expect(errorSplitRow(p, ['ap-northeast-1'], false)).toEqual({ t: 5, error4xx: 1, error5xx: 1 });
  });
});

describe('latencyComponents', () => {
  it('bỏ thành phần không có mẫu, giữ số mẫu riêng của từng thành phần', () => {
    expect(latencyComponents(undefined, emptyBreakdown)).toEqual([]);
    const parts = latencyComponents(stats({ samples: 100 }), { ...emptyBreakdown, samples: 40, gatewayAvgMs: 12, gatewayP95Ms: 30, upstreamSamples: 35, upstreamAvgMs: 90, upstreamP95Ms: null });
    expect(parts.map((p) => [p.key, p.samples, p.p95Ms])).toEqual([
      ['gateway', 40, 30],
      ['upstream', 35, null],
      ['total', 100, 250],
    ]);
  });
});
