import { afterEach, expect, it, vi } from 'vitest';
import { envConfig, gatewayBase, requestUrl, sendGatewayRequest } from './integration';

afterEach(() => vi.unstubAllGlobals());

it('giữ đúng stage và API khi ghép đường dẫn, từ chối URL không hợp lệ và thoát route', () => {
  expect(requestUrl('https://gateway.example/demo/', 'api-1', '/orders?limit=10')).toBe('https://gateway.example/demo/proxy/api-1/orders?limit=10');
  for (const url of ['http://gateway.example', 'https://user:secret@gateway.example', 'https://gateway.example/?key=secret', 'https://gateway.example/#fragment']) {
    expect(() => gatewayBase(url)).toThrow();
  }
  for (const path of ['https://other.example', '//other.example', '/../other/orders', '/%2e%2e/other/orders', '/orders#fragment', '/\\other.example']) {
    expect(() => requestUrl('https://gateway.example/demo', 'api-1', path)).toThrow();
  }
});

it('xuất cấu hình server đúng giá trị và không cho chèn dòng qua key', () => {
  expect(envConfig('https://gateway.example/demo/', 'api-1', 'mrk_secret')).toContain('MRAPI_API_KEY=mrk_secret\n');
  expect(() => envConfig('https://gateway.example', 'api-1', 'key\nOTHER=value')).toThrow();
});

it('gọi gateway bằng x-api-key, không gửi phiên portal và vẫn đọc phản hồi HTTP lỗi', async () => {
  const fetch = vi.fn(async () => new Response('{"error":"revoked","echo":"mrk_secret"}', { status: 403, headers: { 'x-served-region': 'ap-southeast-1', 'x-request-id': 'request-1' } }));
  vi.stubGlobal('fetch', fetch);
  const signal = new AbortController().signal;
  const result = await sendGatewayRequest('https://gateway.example/demo/proxy/api-1/orders', 'mrk_secret', signal);
  expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ headers: { 'x-api-key': 'mrk_secret' }, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal }));
  expect(result.status).toBe(403);
  expect(result.region).toBe('ap-southeast-1');
  expect(result.body).toContain('[API KEY ĐÃ ẨN]');
  expect(result.body).not.toContain('mrk_secret');
});

it('giới hạn kích thước hiển thị phản hồi', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(70000))));
  const result = await sendGatewayRequest('https://gateway.example/proxy/api-1/orders', '', new AbortController().signal);
  expect(result.truncated).toBe(true);
  expect(result.body.length).toBe(65536);
});
