import { portalBase, readToken } from '../portal/client';
import {
  type DataSource,
  type EndpointStat,
  type IncidentEvent,
  type KeyFilter,
  type Metric,
  type MonitoringSnapshot,
  type RangeKey,
  type RegionFilter,
  type RegionSnapshot,
  type RouteStat,
  type TenantReportExtras,
  type TrafficStats,
  missing,
  REGIONS,
  value,
} from '../domain/types';
import { buildEndpoints, buildIncidents, buildSnapshot } from './mock/generator';
import { buildRoutes } from './mock/routes';
import type { MonitoringProvider } from './provider';
import { awsSources } from './sources';
import { nullable, reportExtras, statsFields } from './report';
import { validIncidents, validReport, validSnapshot, validSources } from './validation';

const wait = (ms: number) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

// Dữ liệu mẫu sinh ngay trong trình duyệt.
export class MockProvider implements MonitoringProvider {
  readonly id = 'mock';
  constructor(
    private readonly delayMs = 250,
    private readonly now: () => number = Date.now,
  ) {}

  async getSnapshot(range: RangeKey, _keyId?: KeyFilter, region: RegionFilter = 'all'): Promise<MonitoringSnapshot> {
    await wait(this.delayMs);
    return buildSnapshot(range, this.now(), region);
  }

  async getEndpoints(range: RangeKey): Promise<EndpointStat[]> {
    await wait(this.delayMs);
    return buildEndpoints(range, this.now());
  }

  async getRoutes(range: RangeKey): Promise<RouteStat[]> {
    await wait(this.delayMs);
    return buildRoutes(range, this.now());
  }

  async getIncidents(): Promise<IncidentEvent[]> {
    await wait(this.delayMs);
    return buildIncidents(this.now());
  }

  async getSources(): Promise<DataSource[]> {
    await wait(this.delayMs);
    return [
      {
        id: 'mock',
        service: 'Bộ dữ liệu mẫu (trong trình duyệt)',
        regions: 'Không thuộc Region nào',
        status: 'mock',
        metrics: ['Toàn bộ số liệu đang hiển thị trên dashboard'],
        lastSync: this.now(),
        note: 'Sinh bằng công thức trong src/data/mock/generator.ts. Không phải số liệu AWS.',
        guide: 'README.md',
      },
      ...awsSources('not_connected'),
    ];
  }
}

function emptyRegion(region: RegionSnapshot['region']): RegionSnapshot {
  const none = missing('not_connected');
  return {
    region,
    healthCheck: none,
    trafficSharePct: none,
    requests: none,
    successRatePct: none,
    errorRatePct: none,
    latencyAvgMs: none,
    latencyP95Ms: none,
    lambda: { invocations: none, errors: none, durationAvgMs: none },
    apiGateway: { requests: none, error4xx: none, error5xx: none },
    dynamodbReplicationLatencyMs: none,
    s3ReplicationLatencyS: none,
  };
}

// Chế độ live nhưng chưa cấu hình backend: không có số liệu nào, mọi thứ là "Not connected".
export class NotConnectedProvider implements MonitoringProvider {
  readonly id = 'none';

  async getSnapshot(range: RangeKey): Promise<MonitoringSnapshot> {
    return {
      dataMode: 'live',
      generatedAt: null,
      range,
      routingPolicy: missing('not_connected'),
      regions: REGIONS.map((r) => emptyRegion(r.code)),
      series: [],
    };
  }

  async getEndpoints(): Promise<EndpointStat[]> {
    return [];
  }

  async getRoutes(): Promise<RouteStat[]> {
    return [];
  }

  async getIncidents(): Promise<IncidentEvent[]> {
    return [];
  }

  async getSources(): Promise<DataSource[]> {
    return awsSources('not_connected');
  }
}

// Báo cáo traffic của riêng doanh nghiệp (GET /api/report của portal), lọc được theo API key.
export interface ReportRegion {
  region: RegionSnapshot['region'];
  requests: number;
  success: number;
  error4xx: number;
  error5xx: number;
  gatewayErrors: number;
  upstreamErrors: number;
  latencyAvgMs: number;
  latencyP95Ms: number;
  // schemaVersion 2: chỉ lọc theo keyId, không theo region.
  stats?: TrafficStats;
}
export interface TenantReport extends TenantReportExtras {
  range: RangeKey;
  keyId: string | null;
  generatedAt: number;
  regions: ReportRegion[];
  series: MonitoringSnapshot['series'];
  endpoints: EndpointStat[];
  routes: RouteStat[];
}

const pct = (part: number, total: number): Metric => (total > 0 ? value(Math.round((part / total) * 10_000) / 100) : missing('unavailable'));
// Ghép số liệu hạ tầng (health check, Lambda, replication: chung của nền tảng) với traffic của doanh nghiệp/key.
export function mergeReport(platform: MonitoringSnapshot, report: TenantReport): MonitoringSnapshot {
  const total = report.regions.reduce((s, r) => s + r.requests, 0);
  const extras = reportExtras(report);
  return {
    ...platform,
    generatedAt: report.generatedAt,
    series: report.series,
    ...(extras ? { report: extras } : {}),
    regions: platform.regions.map((p) => {
      const r = report.regions.find((x) => x.region === p.region);
      // Không bao giờ để lọt số /proxy toàn hệ thống (mọi doanh nghiệp) vào ô traffic của doanh nghiệp.
      if (!r) {
        const none = missing('unavailable');
        return { ...p, trafficSharePct: none, requests: none, successRatePct: none, errorRatePct: none, serverErrorRatePct: none,
          gatewayErrorRatePct: none, upstreamErrorRatePct: none, latencyAvgMs: none, latencyP95Ms: none };
      }
      const hasTraffic = r.requests > 0;
      return {
        ...p,
        trafficSharePct: pct(r.requests, total),
        requests: value(r.requests),
        successRatePct: pct(r.success, r.requests),
        errorRatePct: pct(r.error4xx + r.error5xx, r.requests),
        serverErrorRatePct: pct(r.error5xx, r.requests),
        gatewayErrorRatePct: pct(r.gatewayErrors, r.requests),
        upstreamErrorRatePct: pct(r.upstreamErrors, r.requests),
        latencyAvgMs: hasTraffic ? value(r.latencyAvgMs) : missing('unavailable'),
        latencyP95Ms: hasTraffic ? value(r.latencyP95Ms) : missing('unavailable'),
        ...(r.stats
          ? {
              ...statsFields(r.stats),
              // Ưu tiên tỷ lệ theo errorClass (schemaVersion 2); regions[].gatewayErrors/upstreamErrors giữ nghĩa cũ.
              gatewayErrorRatePct: nullable(r.stats.gatewayErrorRatePct),
              upstreamErrorRatePct: nullable(r.stats.upstreamErrorRatePct),
            }
          : {}),
      };
    }),
  };
}

const shortPath = (url: string) => url.replace(/^https?:\/\/[^/]+/, '');

// Gọi backend giám sát qua HTTP. Hợp đồng JSON: docs/integration/backend-api.md.
// Số liệu hạ tầng lấy từ /monitoring/*; traffic (request, lỗi, độ trễ, endpoint, quốc gia) lấy từ telemetry
// của doanh nghiệp đang đăng nhập qua /api/report, nên mỗi doanh nghiệp chỉ thấy request của mình.
export class HttpProvider implements MonitoringProvider {
  readonly id = 'http';
  private readonly baseUrl: string;
  private readonly reports = new Map<string, { at: number; promise: Promise<TenantReport> }>();

  constructor(
    baseUrl: string,
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
    private readonly reportBase: string = portalBase,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private async get<T>(url: string, check: (body: unknown) => boolean): Promise<T> {
    const token = readToken();
    const response = await this.fetchFn(url, { headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    if (!response.ok) throw new Error(`Backend trả HTTP ${response.status} cho ${shortPath(url)}`);
    const body: unknown = await response.json();
    if (!check(body)) throw new Error(`Backend trả dữ liệu sai định dạng cho ${shortPath(url)}`);
    return body as T;
  }

  private monitoring<T>(path: string, check: (body: unknown) => boolean): Promise<T> {
    return this.get(`${this.baseUrl}${path}`, check);
  }

  // Ba trang cùng lúc cần cùng một báo cáo; giữ kết quả vài giây để không truy vấn telemetry ba lần.
  // region: chỉ gửi khi khác 'all' để backend cũ (không biết tham số này) nhận đúng URL như trước.
  report(range: RangeKey, keyId: KeyFilter = 'all', region: RegionFilter = 'all'): Promise<TenantReport> {
    const id = `${readToken() ?? ''}|${range}|${keyId}|${region}`;
    const cached = this.reports.get(id);
    if (cached && Date.now() - cached.at < 5000) return cached.promise;
    const regionParam = region === 'all' ? '' : `&region=${encodeURIComponent(region)}`;
    const promise = this.get<TenantReport>(`${this.reportBase}/api/report?range=${range}&keyId=${encodeURIComponent(keyId)}${regionParam}`, validReport);
    this.reports.set(id, { at: Date.now(), promise });
    promise.catch(() => this.reports.delete(id));
    return promise;
  }

  async getSnapshot(range: RangeKey, keyId: KeyFilter = 'all', region: RegionFilter = 'all'): Promise<MonitoringSnapshot> {
    const [platform, report] = await Promise.all([
      this.monitoring<MonitoringSnapshot>(`/monitoring/snapshot?range=${range}`, validSnapshot),
      this.report(range, keyId, region),
    ]);
    return mergeReport(platform, report);
  }

  async getEndpoints(range: RangeKey, keyId: KeyFilter = 'all'): Promise<EndpointStat[]> {
    return (await this.report(range, keyId)).endpoints;
  }

  async getRoutes(range: RangeKey, keyId: KeyFilter = 'all'): Promise<RouteStat[]> {
    return (await this.report(range, keyId)).routes;
  }

  getIncidents(): Promise<IncidentEvent[]> {
    return this.monitoring('/monitoring/incidents', validIncidents);
  }

  getSources(): Promise<DataSource[]> {
    return this.monitoring('/monitoring/sources', validSources);
  }
}

export function createProvider(demoMode: boolean, backendUrl: string): MonitoringProvider {
  if (demoMode) return new MockProvider();
  return backendUrl ? new HttpProvider(backendUrl) : new NotConnectedProvider();
}
