// Logic hiển thị cho báo cáo traffic (không phụ thuộc React), tách riêng để kiểm thử.
import { maxMetric, sumMetrics, weightedAverage } from './status';
import {
  type BucketStats,
  type ErrorClass,
  type LatencyBreakdown,
  type LatencyStats,
  type Metric,
  missing,
  type MonitoringSnapshot,
  type RegionFilter,
  type RegionSnapshot,
  type SeriesPoint,
  value,
} from './types';

const nullable = (n: number | null | undefined): Metric => (typeof n === 'number' ? value(n) : missing('unavailable'));

// Một percentile toàn hệ thống. upperBound = true khi chỉ suy được cận trên (max p95 các Region, backend cũ);
// khi đó giao diện phải ghi rõ "cận trên", không gọi là p95.
export interface PercentileKpi {
  metric: Metric;
  upperBound: boolean;
}

export interface OverviewTotals {
  pooled: boolean; // true = lấy từ report.totals (mẫu thô gộp)
  requests: Metric;
  successPct: Metric;
  errorPct: Metric;
  avgMs: Metric;
  p95: PercentileKpi;
  p99: PercentileKpi | null; // null = backend không có số liệu p99 nào → N/A
}

// KPI toàn hệ thống. Ưu tiên report.totals (gộp mẫu thô, đã lọc theo region + key ở backend).
// Backend cũ: cộng/trung bình có trọng số theo Region; percentile chỉ còn cận trên = max p95 các Region,
// trừ khi đang lọc đúng một Region (khi đó p95 của Region đó là p95 thật của phạm vi đang xem).
export function overviewTotals(snapshot: MonitoringSnapshot, region: RegionFilter = 'all'): OverviewTotals {
  const totals = snapshot.report?.totals;
  if (totals) {
    return {
      pooled: true,
      requests: value(totals.requests),
      successPct: nullable(totals.successRatePct),
      errorPct: nullable(totals.errorRatePct),
      avgMs: nullable(totals.latency.avgMs),
      p95: { metric: nullable(totals.latency.p95Ms), upperBound: false },
      p99: { metric: nullable(totals.latency.p99Ms), upperBound: false },
    };
  }
  const regions = snapshot.regions.filter((r) => region === 'all' || r.region === region);
  const weightBy = (pick: (r: RegionSnapshot) => Metric) => weightedAverage(regions.map((r) => ({ metric: pick(r), weight: r.requests })));
  const upperBound = regions.length > 1;
  const p99s = regions.map((r) => r.latencyP99Ms).filter((m): m is Metric => m !== undefined);
  return {
    pooled: false,
    requests: sumMetrics(regions.map((r) => r.requests)),
    successPct: weightBy((r) => r.successRatePct),
    errorPct: weightBy((r) => r.errorRatePct),
    avgMs: weightBy((r) => r.latencyAvgMs),
    p95: { metric: maxMetric(regions.map((r) => r.latencyP95Ms)), upperBound },
    p99: p99s.length ? { metric: maxMetric(p99s), upperBound } : null,
  };
}

// ----- Điểm của biểu đồ theo thời gian: null = khoảng trống (không có dữ liệu), không bao giờ vẽ thành 0 -----

// Số request: 0 là 0 thật (telemetry ghi mọi request vào proxy, kể cả khi hasData=false).
// Chỉ thiếu hẳn ô của Region mới là "không có dữ liệu".
export function requestPoint(b: BucketStats | undefined): number | null {
  return b ? b.requests : null;
}

// Độ trễ: ưu tiên bucket.latency (null ⇔ không có request). Backend cũ trả 0 cho ô rỗng → coi là không có dữ liệu.
export function latencyPoint(b: BucketStats | undefined, pick: 'avg' | 'p95' | 'p99'): number | null {
  if (!b) return null;
  if (b.latency !== undefined) {
    if (b.latency === null) return null;
    return pick === 'avg' ? b.latency.avgMs : pick === 'p95' ? b.latency.p95Ms : b.latency.p99Ms;
  }
  if (b.requests === 0 || b.hasData === false) return null;
  if (pick === 'p99') return null; // backend cũ không có p99 theo ô
  return pick === 'avg' ? b.latencyAvgMs : b.latencyP95Ms;
}

// Tỷ lệ lỗi trong ô: không có request thì không có tỷ lệ (khoảng trống, không phải 0%).
export function errorRatePoint(b: BucketStats | undefined): number | null {
  if (!b || b.requests === 0) return null;
  return ((b.error4xx + b.error5xx) / b.requests) * 100;
}

// Timeout trong ô: backend cũ không có trường này → null (N/A), không phải 0.
export function timeoutPoint(b: BucketStats | undefined): number | null {
  return b && typeof b.timeout === 'number' ? b.timeout : null;
}

export const seriesHasTimeout = (series: SeriesPoint[]): boolean => series.some((p) => Object.values(p.regions).some((b) => typeof b?.timeout === 'number'));

export const partialTimes = (series: SeriesPoint[]): number[] => series.filter((p) => p.partial === true).map((p) => p.t);

// Cột lỗi của nhiều Region gộp lại; timeout tách khỏi 5xx khi backend có trường timeout.
export function errorSplitRow(p: SeriesPoint, codes: string[], withTimeout: boolean): { t: number; error4xx: number | null; error5xx: number | null; timeout?: number | null } {
  const buckets = codes.map((c) => (p.regions as Record<string, BucketStats | undefined>)[c]).filter((b): b is BucketStats => !!b);
  if (buckets.length === 0) return withTimeout ? { t: p.t, error4xx: null, error5xx: null, timeout: null } : { t: p.t, error4xx: null, error5xx: null };
  const sum = (pick: (b: BucketStats) => number) => buckets.reduce((s, b) => s + pick(b), 0);
  if (!withTimeout) return { t: p.t, error4xx: sum((b) => b.error4xx), error5xx: sum((b) => b.error5xx) };
  const timeout = sum((b) => b.timeout ?? 0);
  return { t: p.t, error4xx: sum((b) => b.error4xx), error5xx: sum((b) => b.error5xx) - timeout, timeout };
}

// ----- Tách độ trễ gateway / upstream -----
export interface LatencyComponent {
  key: 'gateway' | 'upstream' | 'connect' | 'ttfb' | 'total';
  label: string;
  avgMs: number;
  p95Ms: number | null;
  samples: number;
}

// Chỉ trả thành phần có mẫu (samples > 0 và có giá trị), để không vẽ thanh 0 giả cho phần chưa đo.
export function latencyComponents(latency: LatencyStats | undefined, breakdown: LatencyBreakdown | undefined): LatencyComponent[] {
  const out: LatencyComponent[] = [];
  const push = (key: LatencyComponent['key'], label: string, samples: number | undefined, avg: number | null | undefined, p95: number | null | undefined) => {
    if (samples && samples > 0 && typeof avg === 'number') out.push({ key, label, avgMs: avg, p95Ms: typeof p95 === 'number' ? p95 : null, samples });
  };
  if (breakdown) {
    push('gateway', 'Xử lý tại gateway', breakdown.samples, breakdown.gatewayAvgMs, breakdown.gatewayP95Ms);
    push('upstream', 'Chờ upstream (backend + mạng)', breakdown.upstreamSamples, breakdown.upstreamAvgMs, breakdown.upstreamP95Ms);
    push('connect', '↳ Mở kết nối mới (DNS + TCP + TLS)', breakdown.connectSamples, breakdown.upstreamConnectAvgMs, breakdown.upstreamConnectP95Ms);
    push('ttfb', '↳ Tới byte đầu tiên (TTFB)', breakdown.ttfbSamples, breakdown.upstreamTtfbAvgMs, breakdown.upstreamTtfbP95Ms);
  }
  if (latency) push('total', 'Tổng thời gian tại gateway', latency.samples, latency.avgMs, latency.p95Ms);
  return out;
}

// ----- Phân loại lỗi -----
export const ERROR_CLASS_INFO: Record<ErrorClass, { label: string; family: '4xx' | '5xx'; detail: string }> = {
  client_4xx: { label: 'Gateway từ chối request (4xx)', family: '4xx', detail: 'API không tồn tại hoặc đã tắt, path sai, body quá lớn, backend trỏ IP nội bộ' },
  upstream_4xx: { label: 'Backend trả 4xx', family: '4xx', detail: 'Backend của bạn trả 4xx (ví dụ 404 tài nguyên không có)' },
  gateway: { label: 'Lỗi gateway (5xx)', family: '5xx', detail: 'Lỗi không lường trước trong proxy của nền tảng' },
  upstream_5xx: { label: 'Backend trả 5xx', family: '5xx', detail: 'Backend tự trả 5xx hoặc response quá 4 MB' },
  timeout: { label: 'Timeout backend (504)', family: '5xx', detail: 'Backend không trả lời trong timeout của API' },
  connection_error: { label: 'Không kết nối được backend (502)', family: '5xx', detail: 'DNS, TCP, TLS lỗi hoặc kết nối bị đóng' },
};
