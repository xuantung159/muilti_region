import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.CONTROL_TABLE = 'control';
process.env.TELEMETRY_TABLE = 'telemetry';
const { db } = await import('../../src/shared/lib.mjs');
const { handler } = await import('../../src/dashboard/index.mjs');

test('portal usage aggregates paginated proxy telemetry for the authenticated tenant', async () => {
  const timestamp = new Date().toISOString();
  let pages = 0;
  db.send = async command => {
    const input = command.input;
    if (command.constructor.name === 'GetCommand') return { Item: { tenantId: 'tenant-a', expiresAt: Date.now() / 1000 + 60 } };
    assert.equal(command.constructor.name, 'QueryCommand');
    assert.equal(input.TableName, 'telemetry');
    assert.equal(input.ExpressionAttributeValues[':pk'], 'TENANT#tenant-a');
    assert.equal(input.ConsistentRead, true);
    assert.ok(!input.ExpressionAttributeValues[':from'].startsWith('USAGE#'));
    assert.ok(input.ExpressionAttributeValues[':to'] >= `${timestamp}#request`);
    pages++;
    if (pages === 1) {
      assert.equal(input.ExclusiveStartKey, undefined);
      return { Items: [
        { timestamp, status: 200, latencyMs: 10, region: 'ap-southeast-1', keyId: 'key-a' },
        { timestamp, status: 404, latencyMs: 20, region: 'ap-southeast-1', keyId: 'key-a' },
      ], LastEvaluatedKey: { PK: 'TENANT#tenant-a', SK: 'page-1' } };
    }
    assert.equal(input.ExclusiveStartKey.SK, 'page-1');
    return { Items: [{ timestamp, status: 502, latencyMs: 30, region: 'ap-northeast-1', keyId: 'key-b' }] };
  };
  const result = await handler({ httpMethod: 'GET', path: '/api/usage', headers: { Authorization: `Bearer ${'a'.repeat(64)}` }, queryStringParameters: { range: '1h' } });
  assert.equal(result.statusCode, 200);
  const data = JSON.parse(result.body);
  assert.equal(pages, 2);
  assert.equal(data.source, 'telemetry');
  assert.deepEqual(data.totals, { requests: 3, errors: 2, totalMs: 60 });
  assert.deepEqual(data.byKey['key-a'], { requests: 2, errors: 1 });
  assert.deepEqual(data.byRegion['ap-northeast-1'], { requests: 1, errors: 1 });
  assert.equal(data.series.length, 2);
});

test('empty telemetry stays empty and does not read legacy counters', async () => {
  db.send = async command => {
    if (command.constructor.name === 'GetCommand') return { Item: { tenantId: 'tenant-b', expiresAt: Date.now() / 1000 + 60 } };
    assert.equal(command.input.TableName, 'telemetry');
    assert.equal(command.input.ExpressionAttributeValues[':pk'], 'TENANT#tenant-b');
    return {};
  };
  const result = await handler({ httpMethod: 'GET', path: '/api/usage', headers: { Authorization: `Bearer ${'b'.repeat(64)}` } });
  const data = JSON.parse(result.body);
  assert.deepEqual(data.totals, { requests: 0, errors: 0, totalMs: 0 });
  assert.deepEqual(data.series, []);
});
