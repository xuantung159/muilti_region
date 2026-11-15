import type { DataSource, EndpointStat, IncidentEvent, MonitoringSnapshot, RangeKey, RouteStat } from '../../domain/types';
import { buildRoutes } from '../../data/mock/routes';
import { buildEndpoints, buildIncidents, buildSnapshot } from './generator';
import type { MonitoringProvider } from '../../data/provider';
import { awsSources } from '../../data/sources';
const wait = (ms: number) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

// Dữ liệu mẫu sinh ngay trong trình duyệt.
export class MockProvider implements MonitoringProvider {
  readonly id = 'mock';
  constructor(
    private readonly delayMs = 250,
    private readonly now: () => number = Date.now,
  ) {}

  async getSnapshot(range: RangeKey): Promise<MonitoringSnapshot> {
    await wait(this.delayMs);
    return buildSnapshot(range, this.now());
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

