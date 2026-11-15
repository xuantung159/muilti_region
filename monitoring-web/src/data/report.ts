// Ánh xạ trường schemaVersion 2 của GET /api/report sang mô hình của dashboard. Dùng chung cho HttpProvider
// và bộ sinh dữ liệu mẫu, để hai nguồn đi qua cùng một đường.
import { type Metric, missing, type RegionSnapshot, type TenantReportExtras, type TrafficStats, value } from '../domain/types';

// Giá trị nullable của hợp đồng → Metric: null nghĩa là không có mẫu, không bao giờ đổi thành 0.
export const nullable = (n: number | null | undefined): Metric => (typeof n === 'number' ? value(n) : missing('unavailable'));

// Các trường RegionSnapshot tùy chọn suy từ regions[].stats.
export function statsFields(stats: TrafficStats): Partial<RegionSnapshot> {
  return {
    error4xxRatePct: nullable(stats.error4xxRatePct),
    error5xxRatePct: nullable(stats.error5xxRatePct),
    timeoutRatePct: nullable(stats.timeoutRatePct),
    timeouts: value(stats.timeout),
    latencyP50Ms: nullable(stats.latency.p50Ms),
    latencyP90Ms: nullable(stats.latency.p90Ms),
    latencyP99Ms: nullable(stats.latency.p99Ms),
    latencyBreakdown: stats.breakdown,
    traffic: stats,
  };
}

// Chỉ giữ phần mở rộng thật sự có trong báo cáo; backend cũ → undefined.
export function reportExtras(report: TenantReportExtras): TenantReportExtras | undefined {
  const keys = ['schemaVersion', 'filters', 'window', 'totals', 'errorsByKey', 'errorTypes'] as const;
  const extras = Object.fromEntries(keys.filter((k) => report[k] !== undefined).map((k) => [k, report[k]])) as TenantReportExtras;
  return Object.keys(extras).length ? extras : undefined;
}
