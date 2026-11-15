import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CONTROL_TABLE = 'mrapi-control';
process.env.AWS_REGION = 'ap-southeast-1';
const { db } = await import('../../src/shared/lib.mjs');
const { handler, withCors } = await import('../../src/api/index.mjs');

test('/health có header CORS và expose X-Served-Region', async () => {
  db.send = async () => ({});
  const res = await handler({ httpMethod: 'GET', path: '/health' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Access-Control-Allow-Origin'], '*');
  assert.match(res.headers['Access-Control-Expose-Headers'], /X-Served-Region/);
  assert.equal(res.headers['X-Served-Region'], 'ap-southeast-1');
});

test('withCors bỏ header access-control-* của backend, giữ header khác', () => {
  const res = withCors({
    statusCode: 200,
    headers: { 'access-control-allow-origin': 'https://evil.example', 'content-type': 'application/json', 'X-Served-Region': 'ap-southeast-1' },
    multiValueHeaders: { 'set-cookie': ['a=1', 'b=2'], 'Access-Control-Allow-Headers': ['x'] },
    body: '{}',
  });
  assert.equal(res.headers['Access-Control-Allow-Origin'], '*');
  assert.equal(res.headers['access-control-allow-origin'], undefined);
  assert.equal(res.headers['content-type'], 'application/json');
  assert.deepEqual(res.multiValueHeaders, { 'set-cookie': ['a=1', 'b=2'] });
  assert.equal(res.body, '{}');
});

test('route không tồn tại không gắn CORS', async () => {
  const res = await handler({ httpMethod: 'GET', path: '/khac' });
  assert.equal(res.statusCode, 404);
  assert.equal(res.headers['Access-Control-Allow-Origin'], undefined);
});
