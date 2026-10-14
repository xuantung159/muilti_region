// Health endpoint for the gateway. Proxy forwarding is not implemented yet.
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { CONTROL_TABLE, db, json, routeOf } from '../shared/lib.mjs';

export const handler = async event => {
  const { method, parts } = routeOf(event);
  if (method !== 'GET' || parts.join('/') !== 'health') {
    return json(404, { error: 'Không tìm thấy; proxy chưa triển khai' });
  }
  if (process.env.HEALTH_FORCE_FAIL === 'true') return json(503, { status: 'unhealthy', reason: 'forced' });
  try {
    await db.send(new GetCommand({ TableName: CONTROL_TABLE, Key: { PK: 'HEALTH', SK: 'HEALTH' } }));
    return json(200, { status: 'ok' });
  } catch {
    console.error('health check failed: DynamoDB access');
    return json(503, { status: 'unhealthy', reason: 'dynamodb' });
  }
};
