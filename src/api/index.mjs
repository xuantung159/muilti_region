// Lambda api: health của gateway và proxy /proxy/{apiId}/{đường dẫn} tới backend doanh nghiệp.
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { CONTROL_TABLE, db, json, routeOf } from '../shared/lib.mjs';
import { proxy } from './proxy.mjs';

async function health() {
  if (process.env.HEALTH_FORCE_FAIL === 'true') return json(503, { status: 'unhealthy', reason: 'forced' });
  try {
    await db.send(new GetCommand({ TableName: CONTROL_TABLE, Key: { PK: 'HEALTH', SK: 'HEALTH' } }));
    return json(200, { status: 'ok' });
  } catch {
    console.error('health check failed: DynamoDB access');
    return json(503, { status: 'unhealthy', reason: 'dynamodb' });
  }
}

export const handler = async event => {
  const { method, parts } = routeOf(event);
  if (method === 'GET' && parts.join('/') === 'health') return health();
  if (parts[0] === 'proxy') return proxy(event, parts.slice(1));
  return json(404, { error: 'Không tìm thấy' });
};
