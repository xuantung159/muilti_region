import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
process.env.CONTROL_TABLE = 'mrapi-control';
const { db } = await import('../../src/shared/lib.mjs');
const { handler } = await import('../../src/dashboard/index.mjs');
const items = new Map();
const keyOf = item => `${item.PK}|${item.SK}`;
beforeEach(() => {
  items.clear();
  db.send = async command => {
    const input = command.input;
    if (command.constructor.name === 'GetCommand') return { Item: structuredClone(items.get(keyOf(input.Key))) };
    if (command.constructor.name === 'PutCommand') {
      const old = items.get(keyOf(input.Item));
      if ((input.ConditionExpression === 'attribute_not_exists(PK)' && old) ||
          (input.ExpressionAttributeValues?.[':revision'] !== undefined && old?.revision !== input.ExpressionAttributeValues[':revision'])) {
        throw Object.assign(new Error('Conflict'), { name: 'ConditionalCheckFailedException' });
      }
      items.set(keyOf(input.Item), structuredClone(input.Item)); return {};
    }
    if (command.constructor.name === 'DeleteCommand') { items.delete(keyOf(input.Key)); return {}; }
    if (command.constructor.name === 'QueryCommand') return { Items: [...items.values()].filter(item => item.PK === input.ExpressionAttributeValues[':pk'] && item.SK.startsWith(input.ExpressionAttributeValues[':sk'])) };
    throw new Error(`Unexpected ${command.constructor.name}`);
  };
});
async function call(method, path, body, token) {
  const result = await handler({ httpMethod: method, path, headers: token ? { Authorization: `Bearer ${token}` } : {}, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: result.statusCode, data: JSON.parse(result.body) };
}
const account = email => call('POST', '/api/signup', { orgName: 'Demo', email, password: 'Strong-password-123' });

test('account lifecycle: hash, duplicate email, wrong login, expired/revoked sessions', async () => {
  assert.equal((await account('bad')).status, 400);
  const signup = await account('owner@company.com'); assert.equal(signup.status, 201);
  const stored = items.get('USER#owner@company.com|META'); assert.ok(stored.passwordHash); assert.equal(stored.password, undefined);
  assert.equal((await account('owner@company.com')).status, 409);
  assert.equal((await call('POST', '/api/login', { email: 'owner@company.com', password: 'wrong-password' })).status, 401);
  const login = await call('POST', '/api/login', { email: 'OWNER@company.com', password: 'Strong-password-123' }); assert.equal(login.status, 200);
  assert.equal((await call('GET', '/api/me', undefined, login.data.token)).status, 200);
  await call('POST', '/api/logout', undefined, login.data.token);
  assert.equal((await call('GET', '/api/me', undefined, login.data.token)).status, 401);
  for (const item of items.values()) if (item.PK.startsWith('SESSION#')) item.expiresAt = 0;
  assert.equal((await call('GET', '/api/me', undefined, signup.data.token)).status, 401);
});

test('API registration, updates, disabling and cross-tenant isolation', async () => {
  const x = (await account('x@company.com')).data.token;
  const y = (await account('y@company.com')).data.token;
  const body = { name: 'Payments', baseUrl: 'https://backend.company.com/v1/', timeoutMs: 4000 };
  assert.equal((await call('POST', '/api/apis', body)).status, 401);
  const created = await call('POST', '/api/apis', body, x); assert.equal(created.status, 201);
  const path = `/api/apis/${created.data.api.apiId}`;
  assert.equal(created.data.api.baseUrl, 'https://backend.company.com/v1');
  assert.equal((await call('GET', path, undefined, y)).status, 404);
  assert.equal((await call('PATCH', path, { enabled: false }, y)).status, 404);
  assert.deepEqual((await call('GET', '/api/apis', undefined, y)).data.apis, []);
  assert.equal((await call('PATCH', path, { tenantId: 'other' }, x)).status, 400);
  const updated = await call('PATCH', path, { enabled: false, name: 'Renamed' }, x);
  assert.equal(updated.status, 200); assert.equal(updated.data.api.enabled, false); assert.equal(updated.data.api.revision, 2);
  assert.equal((await call('GET', '/api/apis', undefined, x)).data.apis.length, 1);
  assert.equal((await call('PATCH', path, {}, x)).status, 400);
});

test('reject unsafe URL syntax and invalid timeout before storing configuration', async () => {
  const token = (await account('owner@company.com')).data.token;
  for (const baseUrl of ['http://backend.company.com', 'https://127.0.0.1', 'https://[::1]', 'https://localhost', 'https://app.internal', 'https://u:p@backend.company.com', 'https://backend.company.com?token=x', 'https://backend.company.com:8443']) {
    assert.equal((await call('POST', '/api/apis', { name: 'Test', baseUrl }, token)).status, 400, baseUrl);
  }
  assert.equal((await call('POST', '/api/apis', { name: 'Test', baseUrl: 'https://backend.company.com', timeoutMs: 20000 }, token)).status, 400);
  assert.deepEqual((await call('GET', '/api/apis', undefined, token)).data.apis, []);
});

test('API keys are scoped to the tenant own APIs and returned only once', async () => {
  const x = (await account('x@company.com')).data.token;
  const y = (await account('y@company.com')).data.token;
  const mine = (await call('POST', '/api/apis', { name: 'Payments', baseUrl: 'https://backend.company.com' }, x)).data.api.apiId;
  const theirs = (await call('POST', '/api/apis', { name: 'Other', baseUrl: 'https://other.company.com' }, y)).data.api.apiId;
  assert.equal((await call('POST', '/api/keys', { name: 'App' }, x)).status, 400);
  assert.equal((await call('POST', '/api/keys', { name: 'App', apiIds: ['bad'] }, x)).status, 400);
  assert.equal((await call('POST', '/api/keys', { name: 'App', apiIds: [theirs] }, x)).status, 400);
  const created = await call('POST', '/api/keys', { name: 'App', apiIds: [mine, mine] }, x);
  assert.equal(created.status, 201);
  assert.deepEqual(created.data.key.apiIds, [mine]);
  const stored = items.get(`TENANT#${created.data.apiKey.split('_')[1]}|KEY#${created.data.key.keyId}`);
  assert.equal(stored.apiKey, undefined); assert.ok(stored.keyHash);
  const listed = (await call('GET', '/api/keys', undefined, x)).data.keys;
  assert.deepEqual(listed[0].apiIds, [mine]); assert.equal(listed[0].keyHash, undefined);
  assert.equal((await call('DELETE', `/api/keys/${created.data.key.keyId}`, undefined, y)).status, 404);
  assert.equal((await call('DELETE', `/api/keys/${created.data.key.keyId}`, undefined, x)).data.status, 'revoked');
});

test('seed-admin: admin account with sample project, idempotent, role only via seed', async () => {
  // Mock db nhận lệnh theo tên class, nên dùng class giả cùng tên thay cho @aws-sdk/lib-dynamodb.
  const command = name => ({ [name]: class { constructor(input) { this.input = input; } } })[name];
  const lib = { GetCommand: command('GetCommand'), PutCommand: command('PutCommand'), QueryCommand: command('QueryCommand') };
  const { seedAdmin, ADMIN_EMAIL, SAMPLE_KEY_NAME } = await import('../../scripts/seed-admin.mjs');
  const first = await seedAdmin({ db, cmd: lib, table: 'mrapi-control', password: 'Admin-password-123' });
  assert.deepEqual(first.created, ['user', 'api', 'key']);
  assert.match(first.apiKey, /^mrk_t[a-f0-9]{10}_[a-f0-9]{12}_[a-f0-9]{48}$/);
  const login = await call('POST', '/api/login', { email: ADMIN_EMAIL, password: 'Admin-password-123' });
  assert.equal(login.status, 200); assert.equal(login.data.role, 'admin');
  const me = await call('GET', '/api/me', undefined, login.data.token); assert.equal(me.data.role, 'admin');
  const apis = await call('GET', '/api/apis', undefined, login.data.token);
  assert.deepEqual(apis.data.apis.map(api => api.apiId), [first.apiId]);
  const keys = await call('GET', '/api/keys', undefined, login.data.token);
  assert.deepEqual(keys.data.keys.map(key => [key.name, key.status, key.apiIds]), [[SAMPLE_KEY_NAME, 'active', [first.apiId]]]);

  const again = await seedAdmin({ db, cmd: lib, table: 'mrapi-control' });
  assert.deepEqual(again.created, []); assert.equal(again.apiKey, undefined); assert.equal(again.apiId, first.apiId);
  const rotated = await seedAdmin({ db, cmd: lib, table: 'mrapi-control', newKey: true });
  assert.ok(rotated.apiKey); assert.notEqual(rotated.keyId, first.keyId);
  assert.equal(items.get(`TENANT#${first.tenantId}|KEY#${first.keyId}`).status, 'revoked');

  const normal = await account('user@company.com');
  assert.equal(normal.data.role, undefined);
  assert.equal((await call('GET', '/api/me', undefined, normal.data.token)).data.role, undefined);
});
