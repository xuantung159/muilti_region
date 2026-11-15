// Lambda api: health của gateway và proxy /proxy/{apiId}/{đường dẫn} tới backend doanh nghiệp.
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { CONTROL_TABLE, REGION, db, json, routeOf } from '../shared/lib.mjs';
import { OUTAGE_KEY, outageActive } from '../shared/outage.mjs';
import { consumeColdStart, proxy } from './proxy.mjs';

// Một lần GetItem vừa kiểm tra DynamoDB đọc được, vừa đọc cờ giả lập sự cố (trang Demo failover).
// Cờ chỉ làm /health trả 503 để Route 53 đánh dấu Unhealthy; /proxy vẫn chạy bình thường.
async function health() {
  if (process.env.HEALTH_FORCE_FAIL === 'true') return json(503, { status: 'unhealthy', reason: 'forced' });
  let item;
  try {
    ({ Item: item } = await db.send(new GetCommand({ TableName: CONTROL_TABLE, Key: OUTAGE_KEY })));
  } catch {
    console.error('health check failed: DynamoDB access');
    return json(503, { status: 'unhealthy', reason: 'dynamodb' });
  }
  if (outageActive(item, REGION)) {
    return json(503, { status: 'unhealthy', reason: 'simulated', until: new Date(item.until).toISOString() });
  }
  return json(200, { status: 'ok' });
}

// CORS cho phép trình duyệt gọi thẳng gateway (để Route 53 chọn Region theo vị trí người dùng, không theo
// server trung gian). Không dùng cookie nên origin '*' an toàn; key vẫn bắt buộc qua header x-api-key.
// Preflight OPTIONS do API Gateway trả (method MOCK không qua authorizer), Lambda chỉ gắn header vào response.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'X-Served-Region, X-Request-Id, X-Mrapi-Source',
};

export function withCors(response) {
  const headers = Object.fromEntries(Object.entries(response.headers ?? {}).filter(([name]) => !/^access-control-/i.test(name)));
  const result = { ...response, headers: { ...headers, ...CORS } };
  if (response.multiValueHeaders) {
    result.multiValueHeaders = Object.fromEntries(Object.entries(response.multiValueHeaders).filter(([name]) => !/^access-control-/i.test(name)));
  }
  return result;
}

export const handler = async event => {
  // Lấy cờ cold start ở mọi lần gọi để request /proxy sau một /health trong cùng container không bị tính là cold start.
  const coldStart = consumeColdStart();
  const { method, parts } = routeOf(event);
  if (method === 'GET' && parts.join('/') === 'health') return withCors(await health());
  if (parts[0] === 'proxy') return withCors(await proxy(event, parts.slice(1), { coldStart }));
  return json(404, { error: 'Không tìm thấy' });
};
