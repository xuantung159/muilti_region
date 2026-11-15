// Mô hình dữ liệu chung của dashboard. Giao diện chỉ biết các kiểu này,
// không biết dữ liệu đến từ bộ sinh mẫu hay từ AWS.

export const REGIONS = [
  { code: 'ap-southeast-1', name: 'Singapore' },
  { code: 'ap-northeast-1', name: 'Tokyo' },
] as const;

export type RegionCode = (typeof REGIONS)[number]['code'];

export const regionName = (code: RegionCode): string => REGIONS.find((r) => r.code === code)!.name;

// Một metric hoặc có giá trị, hoặc nêu rõ vì sao không có. Không có trạng thái "mặc định là 0".
export type MissingReason = 'not_connected' | 'unavailable' | 'not_configured';
export type Metric<T = number> = { kind: 'value'; value: T } | { kind: 'missing'; reason: MissingReason };

export const value = <T>(v: T): Metric<T> => ({ kind: 'value', value: v });
export const missing = (reason: MissingReason): Metric<never> => ({ kind: 'missing', reason });

export type RangeKey = '1h' | '6h' | '24h' | '7d';
// Lọc báo cáo theo một API key của doanh nghiệp; 'all' = mọi key.
export type KeyFilter = 'all' | string;
export type DataMode = 'mock' | 'live';
// Lọc báo cáo theo Region phục vụ (tham số region của GET /api/report). Chỉ áp dụng cho totals, errorsByKey,
// errorTypes, endpoints, routes; regions[] và series luôn đủ hai Region.
export type RegionFilter = 'all' | RegionCode;

// ----- Hợp đồng /api/report schemaVersion 2 (docs/performance/LATENCY_ANALYSIS.md §5.2). Mọi trường đều tùy chọn
// phía dashboard để backend cũ vẫn chạy. -----
export const ERROR_CLASSES = ['client_4xx', 'gateway', 'upstream_4xx', 'upstream_5xx', 'timeout', 'connection_error'] as const;
export type ErrorClass = (typeof ERROR_CLASSES)[number];
export type ErrorClassCounts = Record<ErrorClass, number>;

// null ⇔ samples === 0. Percentile nearest-rank trên mẫu thô gộp.
export interface LatencyStats {
  samples: number;
  avgMs: number | null;
  p50Ms: number | null;
  p90Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  maxMs: number | null;
}

// Chỉ tính trên item có trường tương ứng (schemaVersion 2). null ⇔ samples nhóm đó = 0.
export interface LatencyBreakdown {
  samples: number;
  gatewayAvgMs: number | null;
  gatewayP95Ms: number | null;
  upstreamSamples: number;
  upstreamAvgMs: number | null;
  upstreamP95Ms: number | null;
  connectSamples: number;
  upstreamConnectAvgMs: number | null;
  upstreamConnectP95Ms: number | null;
  ttfbSamples: number;
  upstreamTtfbAvgMs: number | null;
  upstreamTtfbP95Ms: number | null;
  reusedConnectionPct: number | null;
  coldStarts: number;
}

export interface TrafficStats {
  requests: number;
  success: number;
  error4xx: number;
  error5xx: number;
  timeout: number;
  errorsByClass: ErrorClassCounts;
  // Mọi tỷ lệ: null ⇔ requests === 0.
  successRatePct: number | null;
  errorRatePct: number | null;
  error4xxRatePct: number | null;
  error5xxRatePct: number | null;
  gatewayErrorRatePct: number | null;
  upstreamErrorRatePct: number | null;
  timeoutRatePct: number | null;
  latency: LatencyStats;
  latencySuccess: LatencyStats;
  breakdown: LatencyBreakdown;
}

export interface KeyErrorStat {
  keyId: string;
  name: string | null;
  status: 'active' | 'revoked' | null;
  requests: number;
  error4xx: number;
  error5xx: number;
  timeout: number;
  errorsByClass: ErrorClassCounts;
  errorRatePct: number | null;
}

export interface ErrorTypeStat {
  errorClass: ErrorClass;
  errorType: string | null;
  status: number;
  region: RegionCode;
  count: number;
  lastSeen: number;
}

// Phần báo cáo của doanh nghiệp không gắn với một Region cụ thể (chỉ có khi backend trả schemaVersion 2,
// hoặc dữ liệu mẫu). totals là mẫu thô gộp sau bộ lọc region + keyId, không phải max/avg của Region.
export interface TenantReportExtras {
  schemaVersion?: number;
  filters?: { range: RangeKey; keyId: string | null; region: RegionFilter };
  window?: { startMs: number; endMs: number; bucketMs: number; buckets: number };
  totals?: TrafficStats;
  errorsByKey?: KeyErrorStat[];
  errorTypes?: ErrorTypeStat[];
}

export interface RegionSnapshot {
  region: RegionCode;
  healthCheck: Metric<'healthy' | 'unhealthy'>;
  // Tỷ lệ traffic Region này đang nhận, theo phần trăm.
  trafficSharePct: Metric;
  // Request người dùng tới API doanh nghiệp (/proxy/...). Không gồm Route 53 health check (/health),
  // portal (/api/*) và chính dashboard (/monitoring/*); các traffic đó chỉ nằm trong apiGateway (toàn stage).
  requests: Metric;
  successRatePct: Metric;
  // Gồm cả 4xx (key sai, route sai...) lẫn 5xx; dùng để hiển thị, không dùng để kết luận Region hỏng.
  errorRatePct: Metric;
  // Chỉ 5xx của /proxy: lỗi phía gateway hoặc backend. Trạng thái Region dựa vào số này.
  // Tùy chọn để tương thích với backend cũ chưa trả trường này.
  serverErrorRatePct?: Metric;
  // Tách 5xx theo nguồn (từ telemetry): lỗi do chính gateway (nền tảng hỏng) và lỗi của backend khách hàng
  // (502/504 không kết nối được, hoặc backend tự trả 5xx). Chỉ lỗi gateway mới làm Region Degraded/Down.
  gatewayErrorRatePct?: Metric;
  upstreamErrorRatePct?: Metric;
  // Độ trễ đo từ lúc gateway nhận request tới khi trả lời, gồm cả thời gian backend khách hàng xử lý.
  latencyAvgMs: Metric;
  latencyP95Ms: Metric;
  // Trường tùy chọn từ regions[].stats (schemaVersion 2). Không có (backend cũ) → giao diện hiện "N/A", không hiện 0.
  error4xxRatePct?: Metric;
  error5xxRatePct?: Metric;
  timeoutRatePct?: Metric;
  timeouts?: Metric; // số request hết thời gian chờ backend (504 UPSTREAM_TIMEOUT)
  latencyP50Ms?: Metric;
  latencyP90Ms?: Metric;
  latencyP99Ms?: Metric;
  latencyBreakdown?: LatencyBreakdown;
  traffic?: TrafficStats; // bản gốc để trang Lỗi đọc số đếm theo errorClass
  // ----- Hạ tầng dùng chung toàn hệ thống (mọi doanh nghiệp + traffic hệ thống), KHÔNG lọc theo key -----
  // Hàm mrapi-proxy, phục vụ cả /proxy lẫn /health, nên invocations gồm cả health check.
  lambda: { invocations: Metric; errors: Metric; durationAvgMs: Metric };
  // Toàn bộ stage API Gateway, gồm cả traffic hệ thống ở trên.
  // healthCheckRequests: phần GET /health do Route 53 gọi; proxyRequests: /proxy của mọi doanh nghiệp cộng lại.
  // Hai trường này tùy chọn để tương thích với backend cũ.
  apiGateway: { requests: Metric; error4xx: Metric; error5xx: Metric; healthCheckRequests?: Metric; proxyRequests?: Metric };
  // Độ trễ replication từ Region này sang Region còn lại.
  dynamodbReplicationLatencyMs: Metric;
  dynamodbReplicationObservedAt?: number | null;
  s3ReplicationLatencyS: Metric;
  s3ReplicationObservedAt?: number | null;
}

export interface BucketStats {
  requests: number;
  success: number;
  error4xx: number;
  error5xx: number;
  latencyAvgMs: number;
  latencyP95Ms: number;
  // ----- schemaVersion 2, tùy chọn -----
  // requests > 0. Số đếm 0 khi hasData=false là 0 thật (telemetry ghi mọi request vào proxy).
  hasData?: boolean;
  timeout?: number;
  gatewayErrors?: number;
  upstreamErrors?: number;
  errorsByClass?: ErrorClassCounts;
  // null ⇔ requests === 0: "không có dữ liệu", không phải 0 ms.
  latency?: { avgMs: number; p50Ms: number; p95Ms: number; p99Ms: number } | null;
}

export interface SeriesPoint {
  t: number; // epoch ms, đầu mỗi ô thời gian
  regions: Record<RegionCode, BucketStats>;
  // true cho ô chứa thời điểm tạo báo cáo: chưa đủ thời gian, số liệu còn thiếu.
  partial?: boolean;
}

export interface MonitoringSnapshot {
  dataMode: DataMode;
  generatedAt: number | null;
  range: RangeKey;
  routingPolicy: Metric<string>;
  regions: RegionSnapshot[];
  series: SeriesPoint[];
  report?: TenantReportExtras;
}

// ANY: route proxy của API Gateway (ANY /proxy/{apiId}/{proxy+}) nhận mọi method, CloudWatch ghi metric theo method khai báo.
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'ANY';

// Request /proxy đến từ quốc gia nào (ISO 3166-1 alpha-2, suy từ IP nguồn; 'ZZ' = không xác định)
// và được Region nào phục vụ, cộng dồn trong khoảng thời gian đang xem.
export interface RouteStat {
  country: string;
  servedRegion: RegionCode;
  requests: number;
  lastSeen: number;
}

export interface EndpointStat {
  method: HttpMethod;
  path: string;
  region: RegionCode;
  requests: number;
  successRatePct: number;
  errorRatePct: number;
  // Chỉ 5xx; tùy chọn để tương thích với backend cũ.
  serverErrorRatePct?: number;
  // Chỉ 5xx do gateway; tùy chọn (backend CloudWatch không có).
  gatewayErrorRatePct?: number;
  apiId?: string;
  latencyAvgMs: number;
  latencyP95Ms?: number;
  lastUpdated: number;
  // schemaVersion 2, tùy chọn
  error4xxRatePct?: number;
  timeoutRatePct?: number;
  errorsByClass?: ErrorClassCounts;
  latencyP50Ms?: number;
  latencyP99Ms?: number;
}

// Nguồn gốc của một sự kiện: phải luôn hiển thị để không nhầm mô phỏng với thực tế.
export type EventOrigin = 'simulated' | 'manual_test' | 'aws';
export type EventKind = 'incident' | 'traffic_shift' | 'failover_test';

export interface IncidentEvent {
  id: string;
  kind: EventKind;
  origin: EventOrigin;
  region: RegionCode | 'global';
  title: string;
  description: string;
  startedAt: number;
  endedAt: number | null;
  recoverySeconds: number | null;
  evidence: { label: string; detail: string }[];
  // Đối chiếu trace X-Ray trong khoảng sự cố (backend chỉ gắn cho các sự kiện gần nhất).
  xray?: XRayCorrelation;
}

export type XRayCorrelation =
  | { status: 'not_connected' }
  | { status: 'error'; detail?: string }
  | {
      status: 'connected';
      start: number;
      end: number;
      traces: number;
      faults: number;
      errors: number;
      throttles: number;
      firstFaultAt: number | null;
      lastFaultAt: number | null;
      truncated: boolean;
      sampleTraceIds: string[];
      consoleUrl: string;
    };

export type SourceStatus = 'mock' | 'not_connected' | 'connected' | 'error';

export interface DataSource {
  id: string;
  service: string;
  regions: string;
  status: SourceStatus;
  metrics: string[];
  lastSync: number | null;
  note: string;
  guide: string; // đường dẫn tài liệu tích hợp trong repo
}
