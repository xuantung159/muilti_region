// Producer export định kỳ: yêu cầu DynamoDB xuất bảng telemetry ra S3 Singapore,
// S3 Replication tự chép sang Tokyo. Hàm chỉ gửi yêu cầu rồi kết thúc; DynamoDB chạy export
// phía máy chủ (khoảng 2 phút), nên timeout ngắn là đủ và hàm không đọc dữ liệu tenant.
//
// ClientToken theo ngày UTC để retry của EventBridge/Lambda không tạo export thứ hai.
// AWS chỉ giữ idempotency 8 giờ sau khi export xong: gọi tay sau đó trong cùng ngày là export mới.
import { DynamoDBClient, ExportTableToPointInTimeCommand } from '@aws-sdk/client-dynamodb';

const REQUIRED_ENV = ['TABLE_ARN', 'EXPORT_BUCKET', 'EXPORT_PREFIX'];

export const loadConfig = (env = process.env) => {
  const missing = REQUIRED_ENV.filter((name) => !env[name]);
  if (missing.length) throw new Error(`Thiếu biến môi trường: ${missing.join(', ')}`);
  return {
    tableArn: env.TABLE_ARN,
    bucket: env.EXPORT_BUCKET,
    // Export cũ dùng prefix không có dấu / cuối; giữ nguyên để object nằm đúng exports/telemetry/AWSDynamoDB/.
    prefix: env.EXPORT_PREFIX.replace(/^\/+|\/+$/g, ''),
  };
};

export const clientTokenFor = (now) => `mrapi-telemetry-${new Date(now).toISOString().slice(0, 10)}`;

export const buildExportInput = (config, now) => ({
  TableArn: config.tableArn,
  S3Bucket: config.bucket,
  S3Prefix: config.prefix,
  ExportFormat: 'DYNAMODB_JSON',
  ExportType: 'FULL_EXPORT',
  ClientToken: clientTokenFor(now),
});

// Lỗi được ném lại để Lambda ghi nhận Errors, alarm mrapi-sg-exporter-errors mới báo được.
export const runExport = async ({ client, config, now = Date.now(), log = console.log }) => {
  const input = buildExportInput(config, now);
  const { ExportDescription: description } = await client.send(new ExportTableToPointInTimeCommand(input));
  const result = {
    exportArn: description?.ExportArn,
    status: description?.ExportStatus,
    clientToken: input.ClientToken,
  };
  log(JSON.stringify({ message: 'EXPORT_REQUESTED', ...result }));
  return result;
};

let sharedClient;

export const handler = async () => {
  const config = loadConfig();
  sharedClient ??= new DynamoDBClient({});
  return runExport({ client: sharedClient, config });
};
