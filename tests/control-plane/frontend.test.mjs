import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../../src/dashboard/index.mjs';

test('portal API root directs users to unified frontend and supports CORS preflight', async () => {
  process.env.FRONTEND_URL = 'https://platform.company.com/';
  process.env.PORTAL_ALLOWED_ORIGIN = 'https://platform.company.com';
  try {
    const root = await handler({ httpMethod: 'GET', path: '/' });
    assert.equal(root.statusCode, 302);
    assert.equal(root.headers.Location, 'https://platform.company.com/portal');
    const preflight = await handler({ httpMethod: 'OPTIONS', path: '/api/me' });
    assert.equal(preflight.statusCode, 204);
    assert.equal(preflight.headers['Access-Control-Allow-Origin'], 'https://platform.company.com');
    assert.match(preflight.headers['Access-Control-Allow-Headers'], /Authorization/);
    const denied = await handler({ httpMethod: 'GET', path: '/api/me' });
    assert.equal(denied.statusCode, 401);
    assert.equal(denied.headers['Access-Control-Allow-Origin'], 'https://platform.company.com');
  } finally { delete process.env.FRONTEND_URL; delete process.env.PORTAL_ALLOWED_ORIGIN; }
});
