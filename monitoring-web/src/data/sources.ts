import type { DataSource, SourceStatus } from '../domain/types';

// Danh mục nguồn AWS mà dashboard dự kiến tích hợp. Trạng thái do từng provider quyết định.
const AWS_SOURCES: Omit<DataSource, 'status' | 'lastSync'>[] = [
  {
    id: 'cloudwatch',
    service: 'AWS CloudWatch',
    regions: 'ap-southeast-1, ap-northeast-1',
    metrics: ['Chuỗi thời gian request, lỗi, latency', 'Alarm state'],
    note: 'Cần backend gọi cloudwatch:GetMetricData ở từng Region.',
    guide: 'docs/integration/cloudwatch.md',
  },
  {
    id: 'api-gateway',
    service: 'Amazon API Gateway',
    regions: 'ap-southeast-1, ap-northeast-1',
    metrics: ['Count', '4xx', '5xx', 'Latency (avg, p95)', 'Số liệu theo route'],
    note: 'Cần API ID và stage của từng Region; bật detailed metrics để có số liệu theo route.',
    guide: 'docs/integration/api-gateway.md',
  },
  {
    id: 'lambda',
    service: 'AWS Lambda',
    regions: 'ap-southeast-1, ap-northeast-1',
    metrics: ['Invocations', 'Errors', 'Duration'],
    note: 'Cần danh sách tên hàm ở từng Region.',
    guide: 'docs/integration/lambda.md',
  },
  {
    id: 'dynamodb',
    service: 'DynamoDB Global Tables',
    regions: 'ap-southeast-1 ⇄ ap-northeast-1',
    metrics: ['ReplicationLatency theo từng chiều'],
    note: 'Cần tên bảng; metric chỉ có sau khi bảng đã thêm replica.',
    guide: 'docs/integration/dynamodb-global-tables.md',
  },
  {
    id: 'route53',
    service: 'Amazon Route 53',
    regions: 'Toàn cục',
    metrics: ['Trạng thái health check', 'Chính sách định tuyến', 'Tỷ lệ traffic theo Region'],
    note: 'Cần health check ID của từng Region; API Route 53 đặt tại us-east-1.',
    guide: 'docs/integration/route53.md',
  },
  {
    id: 's3',
    service: 'Amazon S3 Replication',
    regions: 'ap-southeast-1 ⇄ ap-northeast-1',
    metrics: ['ReplicationLatency', 'OperationsPendingReplication'],
    note: 'Cần bật replication metrics trên rule của từng bucket.',
    guide: 'docs/integration/s3-replication.md',
  },
];

export function awsSources(status: SourceStatus, lastSync: number | null = null): DataSource[] {
  return AWS_SOURCES.map((s) => ({ ...s, status, lastSync }));
}
