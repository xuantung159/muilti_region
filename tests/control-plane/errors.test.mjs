import { test } from 'node:test';
import assert from 'node:assert/strict';
const { ERROR_CLASSES, errorClassOf, recordErrorClass, errorCauseOf } = await import('../../src/shared/errors.mjs');

test('errorClassOf: thành công và status không hợp lệ trả null', () => {
  for (const status of [100, 200, 204, 301, 304, 399]) assert.equal(errorClassOf({ status }), null, String(status));
  assert.equal(errorClassOf({ status: undefined }), null);
  assert.equal(errorClassOf({ status: '500' }), null);
  assert.equal(errorClassOf({}), null);
  assert.equal(errorClassOf(), null);
});

test('errorClassOf: ánh xạ mọi errorType proxy sinh ra (status đúng như proxy trả)', () => {
  const cases = [
    [404, 'API_NOT_FOUND', 'client_4xx'],
    [403, 'API_DISABLED', 'client_4xx'],
    [400, 'BAD_PATH', 'client_4xx'],
    [413, 'PAYLOAD_TOO_LARGE', 'client_4xx'],
    [403, 'TARGET_BLOCKED', 'client_4xx'],
    [500, 'GATEWAY_INTERNAL', 'gateway'],
    [504, 'UPSTREAM_TIMEOUT', 'timeout'],
    [502, 'UPSTREAM_UNREACHABLE', 'connection_error'],
    [502, 'UPSTREAM_TOO_LARGE', 'upstream_5xx'],
    [503, 'UPSTREAM_5XX', 'upstream_5xx'],
    [500, 'UPSTREAM_5XX', 'upstream_5xx'],
  ];
  for (const [status, errorType, expected] of cases) assert.equal(errorClassOf({ status, errorType }), expected, errorType);
});

test('errorClassOf: item cũ không có errorType (lỗi backend trả nguyên) và errorType lạ', () => {
  assert.equal(errorClassOf({ status: 404 }), 'upstream_4xx');
  assert.equal(errorClassOf({ status: 429 }), 'upstream_4xx');
  assert.equal(errorClassOf({ status: 500 }), 'upstream_5xx');
  assert.equal(errorClassOf({ status: 503, errorType: '' }), 'upstream_5xx');
  assert.equal(errorClassOf({ status: 500, errorType: 'SOMETHING_NEW' }), 'gateway');
  assert.equal(errorClassOf({ status: 409, errorType: 'SOMETHING_NEW' }), 'client_4xx');
  // Item cũ đọc từ DynamoDB có đủ trường khác; hàm chỉ dùng status + errorType.
  assert.equal(errorClassOf({ status: 502, errorType: 'UPSTREAM_UNREACHABLE', latencyMs: 30, region: 'ap-southeast-1' }), 'connection_error');
});

test('errorClassOf: tổ hợp không thể xảy ra vẫn giữ đúng nhóm theo status', () => {
  assert.equal(errorClassOf({ status: 500, errorType: 'API_NOT_FOUND' }), 'gateway');
  assert.equal(errorClassOf({ status: 404, errorType: 'UPSTREAM_TIMEOUT' }), 'client_4xx');
});

test('bất biến: error4xx = client_4xx + upstream_4xx, error5xx = gateway + upstream_5xx + timeout + connection_error', () => {
  const types = [undefined, '', 'API_NOT_FOUND', 'API_DISABLED', 'BAD_PATH', 'PAYLOAD_TOO_LARGE', 'TARGET_BLOCKED', 'GATEWAY_INTERNAL',
    'UPSTREAM_TIMEOUT', 'UPSTREAM_UNREACHABLE', 'UPSTREAM_TOO_LARGE', 'UPSTREAM_5XX', 'WHATEVER'];
  const statuses = [200, 301, 400, 401, 403, 404, 413, 429, 499, 500, 502, 503, 504, 599];
  const records = [];
  for (const status of statuses) for (const errorType of types) records.push({ status, errorType });
  const counts = Object.fromEntries(ERROR_CLASSES.map(c => [c, 0]));
  for (const r of records) {
    const c = errorClassOf(r);
    if (c) { assert.ok(ERROR_CLASSES.includes(c)); counts[c] += 1; }
  }
  const error4xx = records.filter(r => r.status >= 400 && r.status < 500).length;
  const error5xx = records.filter(r => r.status >= 500).length;
  assert.equal(counts.client_4xx + counts.upstream_4xx, error4xx);
  assert.equal(counts.gateway + counts.upstream_5xx + counts.timeout + counts.connection_error, error5xx);
});

test('recordErrorClass: dùng errorClass đã lưu khi hợp lệ, tính lại khi thiếu/sai', () => {
  assert.equal(recordErrorClass({ status: 502, errorType: 'UPSTREAM_UNREACHABLE', errorClass: 'connection_error' }), 'connection_error');
  assert.equal(recordErrorClass({ status: 502, errorType: 'UPSTREAM_UNREACHABLE' }), 'connection_error');
  assert.equal(recordErrorClass({ status: 502, errorClass: 'bogus' }), 'upstream_5xx');
  // errorClass lưu khác nhóm với status (không thể xảy ra) → tính lại để giữ bất biến.
  assert.equal(recordErrorClass({ status: 404, errorClass: 'timeout' }), 'upstream_4xx');
  assert.equal(recordErrorClass({ status: 200, errorClass: 'gateway' }), null);
});

test('errorCauseOf: chỉ giữ mã dạng [A-Z0-9_], còn lại OTHER; không có mã thì bỏ', () => {
  for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'UND_ERR_SOCKET', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'EAI_AGAIN']) {
    assert.equal(errorCauseOf({ code }), code);
  }
  assert.equal(errorCauseOf({ code: 'bad code; drop table' }), 'OTHER');
  assert.equal(errorCauseOf({ code: 'X'.repeat(65) }), 'OTHER');
  assert.equal(errorCauseOf({ code: 42 }), 'OTHER');
  assert.equal(errorCauseOf({}), undefined);
  assert.equal(errorCauseOf(undefined), undefined);
});
