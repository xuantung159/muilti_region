import type { EndpointStat, Metric, RegionSnapshot } from './types';

export type Health = 'healthy' | 'degraded' | 'down' | 'unknown';

export const THRESHOLDS = {
  errorRateDegradedPct: 2,
  p95DegradedMs: 1000,
  replicationDegradedMs: 2000,
  replicationDownMs: 10_000,
  endpointDegradedPct: 1,
  endpointDownPct: 5,
  // Dưới số request này, tỷ lệ phần trăm quá nhiễu (1 lỗi trong 10 request đã là 10%) nên không dùng để kết luận.
  minSampleRequests: 20,
};

// Tỷ lệ lỗi do chính nền tảng: ưu tiên 5xx gateway tách từ telemetry; không có thì dùng lỗi của Lambda proxy.
// Không dùng 5xx tổng hay p95: hai số đó gồm cả backend của khách hàng (chậm, tunnel tắt trả 502), nếu dùng thì
// một backend chậm làm cả Region "Degraded" dù Route 53 vẫn Healthy.
export function platformErrorRate(r: RegionSnapshot): { pct: number; samples: number } | null {
  if (r.gatewayErrorRatePct?.kind === 'value' && r.requests.kind === 'value') return { pct: r.gatewayErrorRatePct.value, samples: r.requests.value };
  const { invocations, errors } = r.lambda;
  if (invocations.kind === 'value' && errors.kind === 'value' && invocations.value > 0) {
    return { pct: (errors.value / invocations.value) * 100, samples: invocations.value };
  }
  return null;
}

// Health check của Route 53 là nguồn chính: nó gọi /health từ nhiều điểm trên thế giới mỗi 30 giây,
// kể cả khi chưa có ai gọi API. Chỉ health check Unhealthy mới là Down, vì Down nghĩa là Region đang không phục vụ.
// Tỷ lệ lỗi gateway tính trên cả khoảng thời gian đang chọn (ít nhất 1 giờ), nên sau một sự cố đã phục hồi nó vẫn
// cao thêm cả giờ; vì vậy lỗi gateway (đủ mẫu) chỉ hạ Region xuống Degraded: "có sự cố trong khoảng này, hiện đã chạy".
export function deriveRegionHealth(r: RegionSnapshot): Health {
  if (r.healthCheck.kind === 'missing') return 'unknown';
  if (r.healthCheck.value === 'unhealthy') return 'down';
  const platform = platformErrorRate(r);
  if (!platform || platform.samples < THRESHOLDS.minSampleRequests) return 'healthy';
  if (platform.pct >= THRESHOLDS.errorRateDegradedPct) return 'degraded';
  return 'healthy';
}

export function deriveReplicationHealth(latencyMs: Metric): Health {
  if (latencyMs.kind === 'missing') return 'unknown';
  if (latencyMs.value >= THRESHOLDS.replicationDownMs) return 'down';
  if (latencyMs.value >= THRESHOLDS.replicationDegradedMs) return 'degraded';
  return 'healthy';
}

// Endpoint không có health check riêng: chưa có request thì Unknown. Chỉ xét lỗi 5xx;
// mẫu nhỏ thì chỉ cần có 5xx là Degraded, đủ mẫu mới dùng ngưỡng phần trăm.
export function deriveEndpointHealth(e: EndpointStat): Health {
  if (e.requests === 0) return 'unknown';
  const serverError = e.serverErrorRatePct ?? e.errorRatePct;
  if (e.requests < THRESHOLDS.minSampleRequests) return serverError > 0 ? 'degraded' : 'healthy';
  if (serverError >= THRESHOLDS.endpointDownPct) return 'down';
  if (serverError >= THRESHOLDS.endpointDegradedPct) return 'degraded';
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

// Connected and a historical average do not establish current replication health.
export function replicationFreshness(metric: Metric, observedAt: number | null | undefined, now = Date.now()): 'fresh' | 'stale' | 'missing' {
  if (metric.kind === 'missing' || observedAt == null || !Number.isFinite(observedAt)) return 'missing';
  return now - observedAt > 60 * 60 * 1000 || observedAt > now ? 'stale' : 'fresh';
}
export function currentReplicationHealth(metric: Metric, observedAt: number | null | undefined, now = Date.now()): Health {
  return replicationFreshness(metric, observedAt, now) === 'fresh' ? deriveReplicationHealth(metric) : 'unknown';
}
