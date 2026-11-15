import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeReport, isReportAdmin } from '../../src/monitoring/report-auth.mjs';
import { handleRequest } from '../../src/monitoring/index.mjs';
process.env.MONITORING_PORTAL_URL = 'https://portal.example/demo';
const event = { httpMethod: 'GET', path: '/monitoring/incidents', headers: { Authorization: `Bearer ${'a'.repeat(64)}` } };
const reply = (keys, status = 200) => new Response(JSON.stringify({ keys }), { status, headers: { 'Content-Type': 'application/json' } });
test('anonymous reports never invoke portal or report service', async () => {
  assert.equal((await authorizeReport({ headers: {} }, () => { throw Error('unexpected'); })).status, 401);
  const response = await handleRequest({ ...event, headers: {} }, { incidents: () => { throw Error('leak'); } });
  assert.equal(response.statusCode, 401);
});
test('portal session expired, no key, revoked key, active key and outage fail closed', async () => {
  assert.equal((await authorizeReport(event, async () => reply([], 401))).status, 401);
  assert.equal((await authorizeReport(event, async () => reply([]))).status, 403);
  assert.equal((await authorizeReport(event, async () => reply([{ status: 'revoked' }]))).status, 403);
  assert.equal(await authorizeReport(event, async (url, init) => {
    assert.equal(url, 'https://portal.example/demo/api/keys');
    assert.equal(init.headers.Authorization, event.headers.Authorization);
    return reply([{ status: 'active' }]);
  }), null);
  assert.equal((await authorizeReport(event, async () => reply([], 500))).status, 503);
  assert.equal((await authorizeReport(event, async () => { throw Error('offline'); })).status, 503);
});
test('registered key revocation is checked again for cached reports', async () => {
  let active = true;
  let reads = 0;
  const authorize = e => authorizeReport(e, async () => reply([{ status: active ? 'active' : 'revoked' }]));
  const service = { incidents: async () => { reads++; return []; } };
  assert.equal((await handleRequest(event, service, authorize)).statusCode, 200);
  active = false;
  assert.equal((await handleRequest(event, service, authorize)).statusCode, 403);
  assert.equal(reads, 1);
});
test('only portal admins receive shared infrastructure numbers in the snapshot', async () => {
  const snapEvent = { ...event, path: '/monitoring/snapshot' };
  const region = { region: 'ap-southeast-1', healthCheck: { kind: 'value', value: 'healthy' },
    dynamodbReplicationLatencyMs: { kind: 'value', value: 900 },
    lambda: { invocations: { kind: 'value', value: 11097 }, errors: { kind: 'value', value: 0 }, durationAvgMs: { kind: 'value', value: 10 } },
    apiGateway: { requests: { kind: 'value', value: 11092 }, error4xx: { kind: 'value', value: 0 }, error5xx: { kind: 'value', value: 0 } } };
  const service = { snapshot: async () => ({ regions: [region] }) };
  const read = async (admin) => JSON.parse((await handleRequest(snapEvent, service, async () => null, async () => admin)).body).regions[0];
  const user = await read(false);
  assert.deepEqual(user.lambda.invocations, { kind: 'missing', reason: 'unavailable' });
  assert.deepEqual(user.apiGateway.requests, { kind: 'missing', reason: 'unavailable' });
  assert.deepEqual(user.healthCheck, region.healthCheck);
  assert.deepEqual(user.dynamodbReplicationLatencyMs, region.dynamodbReplicationLatencyMs);
  assert.equal((await read(true)).lambda.invocations.value, 11097);
});
test('admin check reads portal /api/me and fails closed', async () => {
  const me = (body, status = 200) => async (url) => { assert.equal(url, 'https://portal.example/demo/api/me'); return new Response(JSON.stringify(body), { status }); };
  assert.equal(await isReportAdmin(event, me({ role: 'admin' })), true);
  assert.equal(await isReportAdmin(event, me({ email: 'a@b.c' })), false);
  assert.equal(await isReportAdmin(event, me({ role: 'admin' }, 401)), false);
  assert.equal(await isReportAdmin(event, async () => { throw Error('offline'); }), false);
  assert.equal(await isReportAdmin({ headers: {} }, () => { throw Error('unexpected'); }), false);
});
