// Response GET /api/report đúng hợp đồng schemaVersion 2 (docs/performance/LATENCY_ANALYSIS.md §5.2), dựng từ bộ sinh
// dữ liệu mẫu. Chỉ dùng trong test; số liệu là minh họa.
import { buildEndpoints, buildSnapshot } from '../../data/mock/generator';
import { buildRoutes } from '../../data/mock/routes';
import type { TenantReport } from '../../data/providers';
import type { RangeKey, RegionFilter } from '../../domain/types';

export function buildReportV2(range: RangeKey, now: number, region: RegionFilter = 'all'): TenantReport {
  const snapshot = buildSnapshot(range, now, region);
  const extras = snapshot.report!;
  return {
    ...extras,
    range,
    keyId: null,
    generatedAt: now,
    regions: snapshot.regions.map((r) => {
      const s = r.traffic!;
      return {
        region: r.region,
        requests: s.requests,
        success: s.success,
        error4xx: s.error4xx,
        error5xx: s.error5xx,
        gatewayErrors: s.errorsByClass.gateway,
        upstreamErrors: s.errorsByClass.upstream_5xx + s.errorsByClass.timeout + s.errorsByClass.connection_error,
        latencyAvgMs: s.latency.avgMs ?? 0,
        latencyP95Ms: s.latency.p95Ms ?? 0,
        stats: s,
      };
    }),
    series: snapshot.series,
    endpoints: buildEndpoints(range, now).filter((e) => region === 'all' || e.region === region),
    routes: buildRoutes(range, now),
  };
}

// Bỏ mọi trường mới: đúng shape của backend cũ.
export function toV1(report: TenantReport): TenantReport {
  const { schemaVersion: _s, filters: _f, window: _w, totals: _t, errorsByKey: _k, errorTypes: _e, ...rest } = report;
  return {
    ...rest,
    regions: report.regions.map(({ stats: _stats, ...r }) => r),
    series: report.series.map((p) => ({
      t: p.t,
      regions: Object.fromEntries(
        Object.entries(p.regions).map(([code, b]) => [code, { requests: b.requests, success: b.success, error4xx: b.error4xx, error5xx: b.error5xx, latencyAvgMs: b.latencyAvgMs, latencyP95Ms: b.latencyP95Ms }]),
      ) as TenantReport['series'][number]['regions'],
    })),
    endpoints: report.endpoints.map(({ error4xxRatePct: _a, timeoutRatePct: _b, errorsByClass: _c, latencyP50Ms: _d, latencyP99Ms: _e2, ...e }) => e),
  };
}
