import type { DataSource, SourceStatus } from '../domain/types';

// Danh mục nguồn AWS, cùng id và tên với backend src/monitoring (GET /monitoring/sources).
// Chỉ dùng khi chưa có backend; trạng thái do từng provider quyết định.
const AWS_SOURCES: Omit<DataSource, 'status' | 'lastSync'>[] = [
  {
    id: 'api-gateway',
    service: 'API Gateway',
    regions: 'Singapore, Tokyo',
    metrics: ['Count', '4XXError', '5XXError', 'Latency'],
    note: 'mrapi-api-sg (43vakggyh5) và mrapi-api-tyo (n39r5pits8), stage demo.',
    guide: 'monitoring-web/docs/integration/api-gateway.md',
  },
  {
    id: 'lambda',
    service: 'Lambda',
    regions: 'Singapore, Tokyo',
    metrics: ['Invocations', 'Errors', 'Duration'],
    note: 'Hàm mrapi-proxy ở từng Region.',
    guide: 'monitoring-web/docs/integration/lambda.md',
  },
  {
    id: 'dynamodb-replication',
    service: 'DynamoDB Global Tables',
    regions: 'Singapore, Tokyo',
    metrics: ['ReplicationLatency'],
    note: 'Bảng mrapi-telemetry, replica hai chiều.',
    guide: 'monitoring-web/docs/integration/dynamodb-global-tables.md',
  },
  {
    id: 's3-replication',
    service: 'S3 Replication',
    regions: 'Singapore (Tokyo chưa bật metrics)',
    metrics: ['ReplicationLatency'],
    note: 'Rule mrapi-sg-to-tyo: mrapi-exports-sg → mrapi-exports-tyo.',
    guide: 'monitoring-web/docs/integration/s3-replication.md',
  },
  {
    id: 'cloudwatch-alarms',
    service: 'CloudWatch Alarms',
    regions: 'Singapore, Tokyo',
    metrics: ['AlarmHistory'],
    note: 'Cần cloudwatch:DescribeAlarmHistory trong role mrapi-monitoring-role.',
    guide: 'monitoring-web/docs/integration/cloudwatch.md',
  },
  {
    id: 'route53',
    service: 'Route 53',
    regions: 'Singapore, Tokyo',
    metrics: ['HealthCheckStatus'],
    note: 'Health check mrapi-sg-health, mrapi-tokyo-health; metric ở CloudWatch us-east-1.',
    guide: 'monitoring-web/docs/integration/route53.md',
  },
  {
    id: 'xray',
    service: 'X-Ray',
    regions: 'Cả hai Region',
    metrics: ['Trace'],
    note: 'Lambda và stage đã bật tracing; backend chưa đọc trace.',
    guide: 'monitoring-web/docs/integration/cloudwatch.md',
  },
];

export function awsSources(status: SourceStatus, lastSync: number | null = null): DataSource[] {
  return AWS_SOURCES.map((s) => ({ ...s, status, lastSync }));
}
