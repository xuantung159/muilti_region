import {
  type DataSource,
  type EndpointStat,
  type IncidentEvent,
  type MonitoringSnapshot,
  type RangeKey,
  type RegionSnapshot,
  missing,
  REGIONS,
} from '../domain/types';
import type { MonitoringProvider } from './provider';
import { awsSources } from './sources';

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

  async getIncidents(): Promise<IncidentEvent[]> {
    return [];
  }

  async getSources(): Promise<DataSource[]> {
    return awsSources('not_connected');
  }
}

// Gọi backend giám sát qua HTTP. Hợp đồng JSON: docs/integration/backend-api.md.
export class HttpProvider implements MonitoringProvider {
  readonly id = 'http';
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private async get<T>(path: string, check: (body: unknown) => boolean): Promise<T> {
    const response = await this.fetchFn(`${this.baseUrl}${path}`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Backend trả HTTP ${response.status} cho ${path}`);
    const body: unknown = await response.json();
    if (!check(body)) throw new Error(`Backend trả dữ liệu sai định dạng cho ${path}`);
    return body as T;
  }

  getSnapshot(range: RangeKey): Promise<MonitoringSnapshot> {
    return this.get(`/monitoring/snapshot?range=${range}`, (b) => {
      const s = b as Partial<MonitoringSnapshot> | null;
      return !!s && Array.isArray(s.regions) && Array.isArray(s.series);
    });
  }

  getEndpoints(range: RangeKey): Promise<EndpointStat[]> {
    return this.get(`/monitoring/endpoints?range=${range}`, Array.isArray);
  }

  getIncidents(): Promise<IncidentEvent[]> {
    return this.get('/monitoring/incidents', Array.isArray);
  }

  getSources(): Promise<DataSource[]> {
    return this.get('/monitoring/sources', Array.isArray);
  }
}

export function createProvider(backendUrl: string): MonitoringProvider {
  return backendUrl ? new HttpProvider(backendUrl) : new NotConnectedProvider();
}
