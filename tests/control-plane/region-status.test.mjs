import test from 'node:test';
import assert from 'node:assert/strict';
import { Route53Client } from '../../src/node_modules/@aws-sdk/client-route-53/dist-cjs/index.js';
process.env.CONTROL_TABLE = 'mrapi-control';
const { db } = await import('../../src/shared/lib.mjs');
const { handler } = await import('../../src/dashboard/index.mjs');
test('status reads actual configured health IDs independently of CallerReference naming', async () => {
  db.send = async () => ({ Item: { tenantId: 'tenant-a', expiresAt: Date.now() / 1000 + 60 } });
  const calls = [];
  const original = Route53Client.prototype.send;
  Route53Client.prototype.send = async function(command) {
    assert.equal(command.constructor.name, 'GetHealthCheckStatusCommand');
    calls.push(command.input.HealthCheckId);
    return { HealthCheckObservations: [{ StatusReport: { Status: 'Success: HTTP Status Code: 200' } }] };
  };
  try {
    const result = await handler({ httpMethod: 'GET', path: '/api/status', headers: { Authorization: `Bearer ${'a'.repeat(64)}` } });
    assert.equal(result.statusCode, 200);
    assert.deepEqual(calls.sort(), ['bfa2df95-4abf-40d2-a240-dbd04acf735c', 'c7764d38-b17d-44df-8d44-4f2791296adc']);
    assert.deepEqual(JSON.parse(result.body).regions, [{ region: 'ap-northeast-1', status: 'healthy' }, { region: 'ap-southeast-1', status: 'healthy' }]);
  } finally { Route53Client.prototype.send = original; }
});
