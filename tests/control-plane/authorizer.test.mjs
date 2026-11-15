import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
process.env.CONTROL_TABLE = 'mrapi-control';
const { db, sha256 } = await import('../../src/shared/lib.mjs');
const { handler } = await import('../../src/authorizer/index.mjs');

const tenantId = 't0123456789';
const keyId = 'abcdef012345';
const apiKey = `mrk_${tenantId}_${keyId}_${'f'.repeat(48)}`;
const allowed = `a${'1'.repeat(32)}`;
const other = `a${'2'.repeat(32)}`;
const arn = 'arn:aws:execute-api:ap-southeast-1:111122223333:gw123/demo';
let key;
beforeEach(() => {
  key = { keyId, status: 'active', apiIds: [allowed], keyHash: sha256(apiKey) };
  db.send = async command => {
    assert.deepEqual(command.input.Key, { PK: `TENANT#${tenantId}`, SK: `KEY#${keyId}` });
    return { Item: key && structuredClone(key) };
  };
});
const call = (apiId, headers = { 'X-Api-Key': apiKey }) => handler({
  headers, path: `/proxy/${apiId}/orders`, pathParameters: { apiId, proxy: 'orders' }, methodArn: `${arn}/GET/proxy/${apiId}/orders`,
});

test('valid key in scope gets Allow for its APIs only and tenant context', async () => {
  const result = await call(allowed);
  assert.equal(result.policyDocument.Statement[0].Effect, 'Allow');
  assert.deepEqual(result.policyDocument.Statement[0].Resource, [`${arn}/*/proxy/${allowed}`, `${arn}/*/proxy/${allowed}/*`]);
  assert.deepEqual(result.context, { tenant_id: tenantId, key_id: keyId });
});

test('missing, malformed, unknown or wrong-secret key is 401 Unauthorized', async () => {
  await assert.rejects(call(allowed, {}), /Unauthorized/);
  await assert.rejects(call(allowed, { 'x-api-key': 'not-a-key' }), /Unauthorized/);
  await assert.rejects(call(allowed, { 'x-api-key': apiKey.replace(/f$/, 'e') }), /Unauthorized/);
  key = undefined;
  await assert.rejects(call(allowed), /Unauthorized/);
});

test('API outside scope gets the same Allow policy, which does not cover the requested API (safe to cache)', async () => {
  const outside = await call(other);
  const [statement] = outside.policyDocument.Statement;
  assert.equal(statement.Effect, 'Allow');
  assert.deepEqual(statement.Resource, [`${arn}/*/proxy/${allowed}`, `${arn}/*/proxy/${allowed}/*`]);
  assert.ok(!statement.Resource.some(r => r.includes(other)));
  // Kết quả cache từ lần gọi sai này vẫn cho phép API hợp lệ của key.
  assert.deepEqual(outside, await call(allowed));
});

test('revoked key and legacy key without scope are denied', async () => {
  key.status = 'revoked';
  assert.equal((await call(allowed)).context.reason, 'KEY_REVOKED');
  key.status = 'active'; delete key.apiIds;
  assert.equal((await call(allowed)).context.reason, 'KEY_SCOPE_DENIED');
});
