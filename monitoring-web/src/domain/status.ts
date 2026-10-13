import type { EndpointStat, Metric, RegionSnapshot } from './types';

export type Health = 'healthy' | 'degraded' | 'down' | 'unknown';

export const THRESHOLDS = {
  errorRateDegradedPct: 2,
  errorRateDownPct: 10,
  p95DegradedMs: 1000,
  replicationDegradedMs: 2000,
  replicationDownMs: 10_000,
  endpointDegradedPct: 1,
  endpointDownPct: 5,
};

// Chỉ kết luận Healthy khi có đủ health check và error rate. Thiếu một trong hai thì là Unknown.
export function deriveRegionHealth(r: RegionSnapshot): Health {
  if (r.healthCheck.kind === 'missing') return 'unknown';
  if (r.healthCheck.value === 'unhealthy') return 'down';
  if (r.errorRatePct.kind === 'missing') return 'unknown';
  if (r.errorRatePct.value >= THRESHOLDS.errorRateDownPct) return 'down';
  if (r.errorRatePct.value >= THRESHOLDS.errorRateDegradedPct) return 'degraded';
  if (r.latencyP95Ms.kind === 'value' && r.latencyP95Ms.value >= THRESHOLDS.p95DegradedMs) return 'degraded';
  return 'healthy';
}

export function deriveReplicationHealth(latencyMs: Metric): Health {
  if (latencyMs.kind === 'missing') return 'unknown';
  if (latencyMs.value >= THRESHOLDS.replicationDownMs) return 'down';
  if (latencyMs.value >= THRESHOLDS.replicationDegradedMs) return 'degraded';
  return 'healthy';
}

export function deriveEndpointHealth(e: EndpointStat): Health {
  if (e.requests === 0) return 'unknown';
  if (e.errorRatePct >= THRESHOLDS.endpointDownPct) return 'down';
  if (e.errorRatePct >= THRESHOLDS.endpointDegradedPct) return 'degraded';
  return 'healthy';
}

// Cộng các metric; nếu không metric nào có giá trị thì giữ nguyên lý do thiếu của metric đầu tiên.
export function sumMetrics(metrics: Metric[]): Metric {
  const present = metrics.filter((m) => m.kind === 'value');
  if (present.length === 0) return metrics[0] ?? { kind: 'missing', reason: 'unavailable' };
  return { kind: 'value', value: present.reduce((s, m) => s + m.value, 0) };
}

export function maxMetric(metrics: Metric[]): Metric {
  const present = metrics.filter((m) => m.kind === 'value');
  if (present.length === 0) return metrics[0] ?? { kind: 'missing', reason: 'unavailable' };
  return { kind: 'value', value: Math.max(...present.map((m) => m.value)) };
}

// Trung bình có trọng số theo số request của từng Region.
export function weightedAverage(pairs: { metric: Metric; weight: Metric }[]): Metric {
  const present = pairs.filter((p) => p.metric.kind === 'value' && p.weight.kind === 'value') as {
    metric: { kind: 'value'; value: number };
    weight: { kind: 'value'; value: number };
  }[];
  const total = present.reduce((s, p) => s + p.weight.value, 0);
  if (present.length === 0 || total === 0) return pairs[0]?.metric.kind === 'missing' ? pairs[0].metric : { kind: 'missing', reason: 'unavailable' };
  return { kind: 'value', value: present.reduce((s, p) => s + p.metric.value * p.weight.value, 0) / total };
}
