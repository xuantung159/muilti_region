import type { DataSource, EndpointStat, IncidentEvent, KeyFilter, MonitoringSnapshot, RangeKey, RegionFilter, RouteStat } from '../domain/types';

// Hợp đồng duy nhất giữa giao diện và nguồn dữ liệu. Thêm nguồn mới = viết một lớp hiện thực interface này.
export interface MonitoringProvider {
  readonly id: 'mock' | 'http' | 'none';
  // keyId: chỉ tính request gửi bằng API key này của doanh nghiệp đang đăng nhập ('all' = mọi key).
  // region: chỉ lọc phần tổng hợp (report.totals, errorsByKey, errorTypes); regions[] và series luôn đủ hai Region.
  getSnapshot(range: RangeKey, keyId?: KeyFilter, region?: RegionFilter): Promise<MonitoringSnapshot>;
  getEndpoints(range: RangeKey, keyId?: KeyFilter): Promise<EndpointStat[]>;
  getRoutes(range: RangeKey, keyId?: KeyFilter): Promise<RouteStat[]>;
  getIncidents(): Promise<IncidentEvent[]>;
  getSources(): Promise<DataSource[]>;
}
