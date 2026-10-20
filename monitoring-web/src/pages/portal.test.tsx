import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MockProvider } from '../test/fixtures/MockProvider';
import { renderApp } from '../test/render';
import { TOKEN_KEY } from '../portal/client';

const token = 'a'.repeat(64);
const account = { orgName: 'Doanh nghiệp A', email: 'a@company.com', tenantId: 'tenant-a' };
let apis: { apiId: string; name: string; baseUrl: string; timeoutMs: number; enabled: boolean }[];
let keys: { keyId: string; name: string; status: string; createdAt: string }[];
let expired = false;
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  const path = url.replace(/^.*\/api\//, '');
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  const method = init?.method ?? 'GET';
  const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  if (path === 'login' || path === 'signup') return reply({ ...account, token });
  if (path === 'logout') return reply({});
  if (expired) return reply({ error: 'Phiên đã hết hạn' }, 401);
  if (path === 'me') return reply(account);
  if (path === 'apis' && method === 'POST') { apis.push({ apiId: 'api-1', enabled: true, ...body }); return reply({ api: apis[0] }, 201); }
  if (path === 'apis/api-1' && method === 'PATCH') { Object.assign(apis[0], body); return reply({ api: apis[0] }); }
  if (path === 'apis') return reply({ apis });
  if (path === 'keys' && method === 'POST') { expect(body.apiIds).toEqual(['api-1']); keys.push({ keyId: 'key-1', name: body.name, status: 'active', createdAt: '2026-10-17T00:00:00Z' }); return reply({ apiKey: 'mrk_secret_once' }, 201); }
  if (path === 'keys/key-1' && method === 'DELETE') { keys[0].status = 'revoked'; return reply({}); }
  if (path === 'keys') return reply({ keys });
  if (path.startsWith('usage?')) return reply({ totals: { requests: 0, errors: 0, totalMs: 0 }, series: [], byRegion: {}, byKey: {} });
  if (path === 'status') return reply({ regions: [] });
  throw new Error(`Unexpected request ${method} ${path}`);
});
beforeEach(() => { sessionStorage.clear(); apis = []; keys = []; expired = false; fetchMock.mockClear(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { sessionStorage.clear(); vi.unstubAllGlobals(); });

it('đăng nhập, tạo/sửa/tắt API và đăng xuất trong frontend dùng chung', async () => {
  const user = userEvent.setup(); renderApp(new MockProvider(), '/portal');
  expect(screen.queryByText('DEMO DATA.')).not.toBeInTheDocument();
  await user.type(screen.getByLabelText('Email'), account.email);
  await user.type(screen.getByLabelText('Mật khẩu'), 'password-123');
  await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));
  expect(await screen.findByText(account.orgName)).toBeInTheDocument();
  expect(sessionStorage.getItem(TOKEN_KEY)).toBe(token);
  await user.type(screen.getByLabelText('Tên API'), 'Orders');
  await user.type(screen.getByLabelText('URL backend'), 'https://backend.company.com');
  await user.click(screen.getByRole('button', { name: 'Đăng ký API' }));
  expect(await screen.findByText('Orders')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Chỉnh sửa' }));
  await user.clear(screen.getByLabelText('Tên API')); await user.type(screen.getByLabelText('Tên API'), 'Orders v2');
  await user.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
  expect(await screen.findByText('Orders v2')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Vô hiệu hóa' }));
  expect(await screen.findByText('Đã tắt')).toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([, init]) => (init?.headers as Record<string, string>)?.Authorization === `Bearer ${token}`)).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Đăng xuất' }));
  expect(await screen.findByRole('button', { name: 'Đăng nhập' })).toBeInTheDocument();
  expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
  expect(screen.queryByText('Orders v2')).not.toBeInTheDocument();
});

it('đăng ký, tạo và thu hồi key; không giữ secret khi đổi tab', async () => {
  apis.push({ apiId: 'api-1', name: 'Payments', baseUrl: 'https://backend.company.com', timeoutMs: 5000, enabled: true });
  const user = userEvent.setup(); renderApp(new MockProvider(), '/portal');
  await user.click(screen.getByRole('button', { name: /Chưa có tài khoản/ }));
  await user.type(screen.getByLabelText('Tên doanh nghiệp'), account.orgName);
  await user.type(screen.getByLabelText('Email'), account.email);
  await user.type(screen.getByLabelText('Mật khẩu'), 'password-123');
  await user.click(screen.getByRole('button', { name: 'Đăng ký' }));
  await screen.findByText(account.orgName);
  await user.click(screen.getByRole('button', { name: 'API key' }));
  await user.type(screen.getByLabelText('Tên ứng dụng'), 'Website');
  await user.click(screen.getByRole('button', { name: 'Tạo key' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Chọn ít nhất một API');
  await user.click(await screen.findByRole('checkbox', { name: 'Payments' }));
  await user.click(screen.getByRole('button', { name: 'Tạo key' }));
  expect(await screen.findByText('mrk_secret_once')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Hướng dẫn' }));
  expect(screen.queryByText('mrk_secret_once')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'API key' }));
  vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
  await user.click(await screen.findByRole('button', { name: 'Thu hồi' }));
  expect(await screen.findByText('Website · Đã thu hồi')).toBeInTheDocument();
});

it('phiên hết hạn trở về đăng nhập và xóa token', async () => {
  sessionStorage.setItem(TOKEN_KEY, token); expired = true;
  renderApp(new MockProvider(), '/portal');
  expect(await screen.findByRole('button', { name: 'Đăng nhập' })).toBeInTheDocument();
  await waitFor(() => expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull());
});

it('API chưa nối không dùng dữ liệu demo hay coi HTML là đăng nhập thành công', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>vite</html>', { headers: { 'Content-Type': 'text/html' } })));
  const user = userEvent.setup(); renderApp(new MockProvider(), '/portal');
  await user.type(screen.getByLabelText('Email'), account.email); await user.type(screen.getByLabelText('Mật khẩu'), 'password-123');
  await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Chưa kết nối API doanh nghiệp');
  expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
});

it('hướng dẫn tích hợp đọc được trước đăng nhập và có mẫu cho ba nền tảng', async () => {
  const user = userEvent.setup(); renderApp(new MockProvider(), '/portal');
  expect(screen.getByRole('heading', { name: '2. Lấy API key' })).toBeInTheDocument();
  expect(screen.getByText(/Đăng ký API đích, cấp key có quyền/)).toBeInTheDocument();
  expect(screen.getByText(/const response = await fetch/)).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText('Ngôn ngữ mẫu'), 'python');
  expect(screen.getByText(/from urllib.request import Request/)).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText('Ngôn ngữ mẫu'), 'curl');
  expect(screen.getByText(/curl --fail-with-body/)).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});


it('cấu hình tích hợp dùng API của doanh nghiệp và kiểm tra URL gateway', async () => {
  sessionStorage.setItem(TOKEN_KEY, token);
  apis.push({ apiId: 'api-orders', name: 'Orders integration', baseUrl: 'https://backend.company.com', timeoutMs: 5000, enabled: true });
  apis.push({ apiId: 'api-disabled', name: 'Disabled integration', baseUrl: 'https://backend.company.com', timeoutMs: 5000, enabled: false });
  const user = userEvent.setup(); renderApp(new MockProvider(), '/portal');
  await screen.findByText(account.orgName);
  await user.click(screen.getByRole('button', { name: 'Hướng dẫn' }));
  expect(await screen.findByLabelText('API tích hợp')).toHaveValue('api-orders');
  expect(screen.queryByRole('option', { name: 'Disabled integration' })).not.toBeInTheDocument();
  const gateway = screen.getByLabelText('URL gateway đã triển khai');
  await user.type(gateway, 'https://gateway.company.com/demo/');
  expect(screen.getByText(/MRAPI_GATEWAY_URL=https:\/\/gateway.company.com\/demo/)).toHaveTextContent('MRAPI_API_ID=api-orders');
  await user.clear(gateway);
  await user.type(gateway, 'http://gateway.company.com');
  expect(screen.getByRole('alert')).toHaveTextContent('Nhập URL HTTPS');
  expect(screen.getByText(/MRAPI_GATEWAY_URL=https:\/\/YOUR_GATEWAY_HOST/)).toBeInTheDocument();
});


it('request thật dùng gateway riêng, không gửi Bearer token và hiển thị lỗi CORS trung thực', async () => {
  sessionStorage.setItem(TOKEN_KEY, token);
  apis.push({ apiId: 'api-live', name: 'Live API', baseUrl: 'https://backend.company.com', timeoutMs: 5000, enabled: true });
  const liveFetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('https://gateway.company.com/')) {
      expect(init?.headers).toEqual({ 'x-api-key': 'mrk_live_test' });
      return new Response('{"orders":[]}', { status: 200, headers: { 'x-served-region': 'ap-southeast-1' } });
    }
    return fetchMock(url, init);
  });
  vi.stubGlobal('fetch', liveFetch);
  const user = userEvent.setup(); renderApp(new MockProvider(), '/portal');
  await screen.findByText(account.orgName);
  await user.click(screen.getByRole('button', { name: 'Tích hợp project' }));
  await user.type(await screen.findByLabelText('Gateway URL'), 'https://gateway.company.com/demo');
  await user.type(screen.getByLabelText('API key tích hợp'), 'mrk_live_test');
  await user.click(screen.getByRole('button', { name: 'Gửi GET tới gateway' }));
  expect(await screen.findByText(/HTTP 200 ·/)).toBeInTheDocument();
  expect(screen.getByText(/Region: ap-southeast-1/)).toBeInTheDocument();
  liveFetch.mockImplementationOnce(async () => { throw new TypeError('Failed to fetch'); });
  await user.click(screen.getByRole('button', { name: 'Gửi GET tới gateway' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Không thể xác định HTTP status');
  expect(screen.queryByText(/HTTP 200 ·/)).not.toBeInTheDocument();
});


it('chuyển key thật vừa tạo sang cấu hình, sao chép env rồi xóa khi rời bước', async () => {
  sessionStorage.setItem(TOKEN_KEY, token);
  apis.push({ apiId: 'api-1', name: 'Orders', baseUrl: 'https://backend.company.com', timeoutMs: 5000, enabled: true });
  const user = userEvent.setup(); renderApp(new MockProvider(), '/portal');
  await screen.findByText(account.orgName);
  expect(screen.queryByRole('button', { name: 'Trải nghiệm demo' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'API key' }));
  await user.type(screen.getByLabelText('Tên ứng dụng'), 'Go client');
  await user.click(await screen.findByRole('checkbox', { name: 'Orders' }));
  await user.click(screen.getByRole('button', { name: 'Tạo key' }));
  await screen.findByText('mrk_secret_once');
  await user.click(screen.getByRole('button', { name: 'Dùng key này để tích hợp' }));
  expect(await screen.findByLabelText('API key tích hợp')).toHaveValue('mrk_secret_once');
  await user.type(screen.getByLabelText('Gateway URL'), 'https://gateway.company.com/demo');
  await user.click(screen.getByRole('button', { name: 'Sao chép .env có key' }));
  expect(await navigator.clipboard.readText()).toContain('MRAPI_API_KEY=mrk_secret_once');
  await user.click(screen.getByRole('button', { name: 'Tổng quan' }));
  await user.click(screen.getByRole('button', { name: 'Tích hợp project' }));
  expect(await screen.findByLabelText('API key tích hợp')).toHaveValue('');
});
