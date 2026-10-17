// Kiểm tra bảng mrapi-telemetry thật trên AWS: ghi, query theo tenant/thời gian, GSI1 lỗi,
// tách biệt tenant và TTL. Chạy bằng credentials có quyền PutItem/Query/DeleteItem trên bảng
// (vd. CloudShell của thành viên), không chạy bằng role Lambda.
//
//   npm run test:telemetry --prefix src            # ghi dữ liệu thử, kiểm tra, rồi xóa
//   KEEP=1 npm run test:telemetry --prefix src     # giữ dữ liệu thử để chụp Console làm bằng chứng
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

// AWS SDK được cài trong src/node_modules (npm ci --prefix src).
const require = createRequire(new URL('../../src/package.json', import.meta.url));
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DeleteCommand, DynamoDBDocumentClient, PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const TableName = process.env.TELEMETRY_TABLE ?? 'mrapi-telemetry';
const region = process.env.AWS_REGION ?? 'ap-southeast-1';
const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

// Hai tenant thử có tiền tố riêng để không lẫn với dữ liệu thật.
const run = randomBytes(3).toString('hex');
const tenants = [`ttest${run}a`, `ttest${run}b`];
const now = Date.now();
const item = (tenantId, offsetMs, status, errorType) => {
  const timestamp = new Date(now - offsetMs).toISOString();
  const requestId = `test-${randomBytes(4).toString('hex')}`;
  const SK = `${timestamp}#${requestId}`;
  return {
    PK: `TENANT#${tenantId}`, SK, requestId, tenantId, apiId: `a${'0'.repeat(32)}`, keyId: 'testkey00000',
    method: 'GET', path: '/orders', status, ...(errorType ? { errorType } : {}), latencyMs: 42, region, timestamp,
    expiresAt: Math.floor(now / 1000) + 30 * 86400,
    ...(errorType ? { GSI1PK: `TENANT#${tenantId}#ERR`, GSI1SK: SK } : {}),
  };
};
const items = [
  item(tenants[0], 60_000, 200), item(tenants[0], 30_000, 504, 'UPSTREAM_TIMEOUT'), item(tenants[0], 2 * 3600_000, 200),
  item(tenants[1], 10_000, 200),
];

const step = (name, ok) => console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
try {
  for (const Item of items) await db.send(new PutCommand({ TableName, Item }));
  step(`ghi ${items.length} item cho 2 tenant thử (${tenants.join(', ')})`, true);

  // 1. Request của tenant A trong 1 giờ gần nhất: chỉ 2 item, không lẫn item 2 giờ trước và tenant B.
  const since = new Date(now - 3600_000).toISOString();
  const recent = await db.send(new QueryCommand({
    TableName, ConsistentRead: true,
    KeyConditionExpression: 'PK = :pk AND SK >= :since',
    ExpressionAttributeValues: { ':pk': `TENANT#${tenants[0]}`, ':since': since },
  }));
  assert.equal(recent.Items.length, 2);
  assert.ok(recent.Items.every(i => i.tenantId === tenants[0]));
  step('query theo tenant + khoảng thời gian trả đúng 2 item của tenant A', true);

  // 2. GSI1 chỉ chứa request lỗi. Index cập nhật bất đồng bộ nên thử lại vài lần.
  let errors = [];
  for (let attempt = 0; attempt < 10 && !errors.length; attempt++) {
    if (attempt) await new Promise(resolve => setTimeout(resolve, 1000));
    errors = (await db.send(new QueryCommand({
      TableName, IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk', ExpressionAttributeValues: { ':pk': `TENANT#${tenants[0]}#ERR` },
    }))).Items;
  }
  assert.equal(errors.length, 1);
  assert.equal(errors[0].errorType, 'UPSTREAM_TIMEOUT');
  step('GSI1 chỉ trả request lỗi của tenant A', true);

  // 3. Tenant B không thấy dữ liệu tenant A khi query bằng khóa của chính mình.
  const other = await db.send(new QueryCommand({
    TableName, ConsistentRead: true,
    KeyConditionExpression: 'PK = :pk', ExpressionAttributeValues: { ':pk': `TENANT#${tenants[1]}` },
  }));
  assert.equal(other.Items.length, 1);
  assert.ok(other.Items.every(i => i.tenantId === tenants[1]));
  step('tenant B chỉ thấy 1 item của chính mình', true);

  // 4. expiresAt là epoch giây (10 chữ số), khoảng 30 ngày sau.
  for (const i of recent.Items) {
    assert.ok(Number.isInteger(i.expiresAt) && String(i.expiresAt).length === 10);
    assert.ok(Math.abs(i.expiresAt - (now / 1000 + 30 * 86400)) < 120);
  }
  step('expiresAt là epoch giây, cách hiện tại khoảng 30 ngày', true);
  console.log('Kết quả: PASS. TTL chỉ xóa sau khi hết hạn (có thể chậm tới vài ngày), không kiểm tra được ngay.');
} catch (err) {
  console.error('FAIL', err.name, err.message);
  process.exitCode = 1;
} finally {
  if (process.env.KEEP) console.log(`Giữ dữ liệu thử: PK TENANT#${tenants[0]} và TENANT#${tenants[1]}; xóa tay trên Console sau khi chụp.`);
  else {
    for (const { PK, SK } of items) await db.send(new DeleteCommand({ TableName, Key: { PK, SK } })).catch(() => {});
    console.log('Đã xóa dữ liệu thử.');
  }
}
