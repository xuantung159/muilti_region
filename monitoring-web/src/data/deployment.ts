// Tài nguyên đã triển khai và chạy được, đối chiếu với config/demo/*.json và AWS (CloudShell, Console) ngày 01/11/2026.
// Chỉ ghi phần đã xong, không lỗi; phần còn thiếu theo dõi ở docs/reports, không đưa lên giao diện.
// Đây là dữ liệu tĩnh nhúng lúc build: khi tài nguyên đổi, cập nhật file này cùng config/demo.
// Trạng thái sống (health check, số request) do trang Hạ tầng lấy từ backend monitoring, không ghi ở đây.

export type DeployScope = 'global' | 'ap-southeast-1' | 'ap-northeast-1';

export interface DeployedResource {
  service: string;
  resource: string;
  note?: string;
}

export const VERIFIED_AT = '01/11/2026';

export const ENDPOINTS = {
  app: 'https://app.multi-region.io.vn',
  api: 'https://api.multi-region.io.vn',
  regional: {
    'ap-southeast-1': 'https://43vakggyh5.execute-api.ap-southeast-1.amazonaws.com/demo',
    'ap-northeast-1': 'https://n39r5pits8.execute-api.ap-northeast-1.amazonaws.com/demo',
  },
} as const;

export const DEPLOYMENT: Record<DeployScope, DeployedResource[]> = {
  global: [
    { service: 'Route 53', resource: 'multi-region.io.vn (Z03093462BF2L4GV4FGRD)', note: 'api.* định tuyến latency tới hai Region' },
    { service: 'Route 53 health check', resource: 'mrapi-sg-health, mrapi-tokyo-health', note: 'Kiểm tra /demo/health của từng Region' },
    { service: 'ACM', resource: 'Chứng chỉ us-east-1, Singapore, Tokyo' },
    { service: 'CloudFront', resource: 'mrapi-web (E33WCNP66CDRPQ) → app.multi-region.io.vn', note: 'Portal; /api/*, /health, /proxy/*, /monitoring/* qua origin mrapi-api-latency (api.multi-region.io.vn)' },
    { service: 'CloudWatch us-east-1', resource: '2 alarm mrapi-health-sg, mrapi-health-tyo', note: 'Cảnh báo theo Route 53 health check' },
    { service: 'IAM', resource: 'Role proxy, authorizer, dashboard, monitoring', note: 'Cùng permissions boundary mrapi-workload-boundary' },
    { service: 'SNS us-east-1', resource: 'mrapi-alerts, subscription email Confirmed' },
    { service: 'AWS Budgets', resource: 'mrapi-monthly, 10 USD/tháng' },
  ],
  'ap-southeast-1': [
    { service: 'API Gateway', resource: 'mrapi-api-sg (43vakggyh5), stage demo', note: 'Custom domain, tracing, access log 14 ngày' },
    { service: 'Lambda', resource: 'proxy, authorizer, dashboard, monitoring, exporter', note: 'Node.js 24.x, arm64, tracing bật' },
    { service: 'EventBridge', resource: 'mrapi-export-daily', note: 'Export telemetry vào S3 lúc 18:00 UTC hằng ngày' },
    { service: 'DynamoDB', resource: 'mrapi-control, mrapi-telemetry', note: 'Global table, replica Tokyo' },
    { service: 'S3', resource: 'mrapi-exports-sg ⇄ mrapi-exports-tyo, mrapi-web-sg', note: 'Replication hai chiều; bucket hosting private qua OAC' },
    { service: 'CloudWatch', resource: '6 alarm mrapi-sg-*', note: 'API, Lambda, telemetry, monitoring, exporter' },
    { service: 'SNS', resource: 'mrapi-alerts, subscription email Confirmed' },
  ],
  'ap-northeast-1': [
    { service: 'API Gateway', resource: 'mrapi-api-tyo (n39r5pits8), stage demo', note: 'Custom domain, tracing, access log 14 ngày' },
    { service: 'Lambda', resource: 'proxy, authorizer, dashboard, monitoring', note: 'Node.js 24.x, arm64, tracing bật' },
    { service: 'DynamoDB', resource: 'Replica mrapi-control, mrapi-telemetry' },
    { service: 'S3', resource: 'mrapi-exports-tyo ⇄ mrapi-exports-sg', note: 'Replication hai chiều, rule ngược mrapi-tyo-to-sg' },
    { service: 'CloudWatch', resource: '5 alarm mrapi-tyo-*', note: 'API, Lambda, telemetry, monitoring' },
    { service: 'SNS', resource: 'mrapi-alerts, subscription email Confirmed' },
  ],
};
