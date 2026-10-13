import type { DataSource, EndpointStat, IncidentEvent, MonitoringSnapshot, RangeKey } from '../domain/types';

// Hợp đồng duy nhất giữa giao diện và nguồn dữ liệu. Thêm nguồn mới = viết một lớp hiện thực interface này.
export interface MonitoringProvider {
  readonly id: 'mock' | 'http' | 'none';
  getSnapshot(range: RangeKey): Promise<MonitoringSnapshot>;
  getEndpoints(range: RangeKey): Promise<EndpointStat[]>;
  getIncidents(): Promise<IncidentEvent[]>;
  getSources(): Promise<DataSource[]>;
}
