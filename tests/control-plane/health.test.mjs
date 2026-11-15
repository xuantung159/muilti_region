import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CONTROL_TABLE = 'mrapi-control';
process.env.AWS_REGION = 'ap-southeast-1';
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

test('health trả 503 simulated chỉ ở Region có cờ còn hạn, một lần GetItem', async () => {
  const event = { httpMethod: 'GET', path: '/health' };
  let item;
  let calls = 0;
  db.send = async command => {
    calls += 1;
    assert.equal(command.constructor.name, 'GetCommand');
    assert.deepEqual(command.input.Key, { PK: 'HEALTH', SK: 'SIMULATED_OUTAGE' });
    return { Item: item };
  };
  const now = Date.now();
  item = { region: 'ap-southeast-1', until: now + 120_000 };
  const failed = await handler(event);
  assert.equal(failed.statusCode, 503);
  assert.equal(JSON.parse(failed.body).reason, 'simulated');
  assert.equal(failed.headers['X-Served-Region'], 'ap-southeast-1');
  assert.equal(calls, 1);

  item = { region: 'ap-northeast-1', until: now + 120_000 }; // Region khác
  assert.equal((await handler(event)).statusCode, 200);
  item = { region: 'ap-southeast-1', until: now - 1 }; // hết hạn
  assert.equal((await handler(event)).statusCode, 200);
  item = { region: 'ap-southeast-1', until: now + 3_600_000 }; // dài bất thường → bỏ qua
  assert.equal((await handler(event)).statusCode, 200);

  db.send = async () => { throw new Error('down'); };
  assert.equal(JSON.parse((await handler(event)).body).reason, 'dynamodb');
});
