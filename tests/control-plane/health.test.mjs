import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CONTROL_TABLE = 'mrapi-control';
const { db } = await import('../../src/shared/lib.mjs');
const { handler } = await import('../../src/api/index.mjs');

test('health checks control; removed orders returns 404; forced failure returns 503', async () => {
  db.send = async command => { assert.equal(command.input.TableName, 'mrapi-control'); return {}; };
  const event = { httpMethod: 'GET', path: '/health' };
  assert.equal((await handler(event)).statusCode, 200);
  assert.equal((await handler({ httpMethod: 'POST', path: '/orders' })).statusCode, 404);
  process.env.HEALTH_FORCE_FAIL = 'true';
  try { assert.equal((await handler(event)).statusCode, 503); }
  finally { delete process.env.HEALTH_FORCE_FAIL; }
});
