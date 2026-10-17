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

test('revoked key, API outside scope and legacy key without scope are denied', async () => {
  const outside = await call(other);
  assert.equal(outside.policyDocument.Statement[0].Effect, 'Deny');
  assert.equal(outside.context.reason, 'KEY_SCOPE_DENIED');
  key.status = 'revoked';
  assert.equal((await call(allowed)).context.reason, 'KEY_REVOKED');
  key.status = 'active'; delete key.apiIds;
  assert.equal((await call(allowed)).context.reason, 'KEY_SCOPE_DENIED');
});
