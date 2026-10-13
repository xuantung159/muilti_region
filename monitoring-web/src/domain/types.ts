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
export type DataMode = 'mock' | 'live';

export interface RegionSnapshot {
  region: RegionCode;
  healthCheck: Metric<'healthy' | 'unhealthy'>;
  // Tỷ lệ traffic Region này đang nhận, theo phần trăm.
  trafficSharePct: Metric;
  requests: Metric;
  successRatePct: Metric;
  errorRatePct: Metric;
  latencyAvgMs: Metric;
  latencyP95Ms: Metric;
  lambda: { invocations: Metric; errors: Metric; durationAvgMs: Metric };
  apiGateway: { requests: Metric; error4xx: Metric; error5xx: Metric };
  // Độ trễ replication từ Region này sang Region còn lại.
  dynamodbReplicationLatencyMs: Metric;
  s3ReplicationLatencyS: Metric;
}

export interface BucketStats {
  requests: number;
  success: number;
  error4xx: number;
  error5xx: number;
  latencyAvgMs: number;
  latencyP95Ms: number;
}

export interface SeriesPoint {
  t: number; // epoch ms, đầu mỗi ô thời gian
  regions: Record<RegionCode, BucketStats>;
}

export interface MonitoringSnapshot {
  dataMode: DataMode;
  generatedAt: number | null;
  range: RangeKey;
  routingPolicy: Metric<string>;
  regions: RegionSnapshot[];
  series: SeriesPoint[];
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface EndpointStat {
  method: HttpMethod;
  path: string;
  region: RegionCode;
  requests: number;
  successRatePct: number;
  errorRatePct: number;
  latencyAvgMs: number;
  lastUpdated: number;
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
}

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
