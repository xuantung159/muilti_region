import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MockProvider } from '../data/providers';
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

it('demo tạo key, gửi request, từ chối key thu hồi và không gọi AWS', async () => {
  const user = userEvent.setup(); renderApp(new MockProvider(), '/portal');
  await user.click(screen.getByRole('button', { name: 'Trải nghiệm demo' }));
  expect(await screen.findByText('Doanh nghiệp mẫu · Demo')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'API key' }));
  await user.type(screen.getByLabelText('Tên ứng dụng'), 'Demo shop');
  await user.click(await screen.findByRole('checkbox', { name: 'API đơn hàng mẫu' }));
  await user.click(screen.getByRole('button', { name: 'Tạo key' }));
  const key = await screen.findByText(/^DEMO_ONLY_demo-key-/);
  const secret = key.textContent!;
  await user.click(screen.getByRole('button', { name: 'Thử request demo' }));
  await user.clear(screen.getByLabelText('API key demo')); await user.type(screen.getByLabelText('API key demo'), secret);
  await user.click(screen.getByRole('button', { name: 'Gửi request mô phỏng' }));
  expect(await screen.findByText('HTTP 200 · Kết quả mô phỏng')).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText('Tình huống'), 'missing');
  await user.click(screen.getByRole('button', { name: 'Gửi request mô phỏng' }));
  expect(await screen.findByText('HTTP 401 · Kết quả mô phỏng')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'API key' }));
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const row = screen.getByText('Demo shop · Đang dùng').parentElement!.parentElement!;
  const revoke = row.querySelector('button')!;
  await user.click(revoke);
  expect(await screen.findByText('Demo shop · Đã thu hồi')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Thử request demo' }));
  await user.clear(screen.getByLabelText('API key demo')); await user.type(screen.getByLabelText('API key demo'), secret);
  await user.click(screen.getByRole('button', { name: 'Gửi request mô phỏng' }));
  expect(await screen.findByText('HTTP 403 · Kết quả mô phỏng')).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Thoát demo, dùng tài khoản thật' }));
  expect(screen.getByRole('button', { name: 'Đăng nhập' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Trải nghiệm demo' }));
  await screen.findByText('Doanh nghiệp mẫu · Demo');
  await user.click(screen.getByRole('button', { name: 'API key' }));
  expect(screen.queryByText('Demo shop · Đã thu hồi')).not.toBeInTheDocument();
});

it('hướng dẫn tích hợp đọc được trước đăng nhập và có mẫu cho ba nền tảng', async () => {
  const user = userEvent.setup(); renderApp(new MockProvider(), '/portal');
  expect(screen.getByRole('heading', { name: '2. Lấy API key' })).toBeInTheDocument();
  expect(screen.getByText(/Proxy chuyển tiếp và key theo phạm vi API đã triển khai/)).toBeInTheDocument();
  expect(screen.getByText(/const response = await fetch/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Python' }));
  expect(screen.getByText(/from urllib.request import Request/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'cURL' }));
  expect(screen.getByText(/curl --fail-with-body/)).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('hướng dẫn project mẫu đi từ tạo key tới dán .env, chạy client và không gọi AWS', async () => {
  const user = userEvent.setup(); renderApp(new MockProvider(), '/portal');
  expect(screen.getByRole('link', { name: 'Tải project mẫu (.zip)' })).toHaveAttribute('href', '/samples/project-mau-mrapi.zip');
  expect(screen.getByRole('button', { name: 'Bước 5: Chạy và xem kết quả' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Chạy backend' }));
  await user.click(screen.getByRole('button', { name: 'Bước tiếp' }));
  await user.click(screen.getByRole('button', { name: 'Đăng ký API' }));
  await user.click(screen.getByRole('button', { name: 'Bước tiếp' }));
  await user.click(screen.getByRole('button', { name: 'Tạo key' }));
  expect(screen.getByText('DEMO_ONLY_KEY_MAU_KHONG_GOI_DUOC_GATEWAY')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Bước tiếp' }));
  expect(screen.getByText('MRAPI_API_KEY=PASTE_YOUR_SECRET_KEY_HERE')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Dán API ID và key' }));
  expect(screen.getByText('MRAPI_API_KEY=DEMO_ONLY_KEY_MAU_KHONG_GOI_DUOC_GATEWAY')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Bước tiếp' }));
  await user.click(screen.getByRole('button', { name: 'Dán sai key' }));
  expect(screen.getByText(/HTTP 401/)).toBeInTheDocument();
  expect(screen.getByText('Tổng quan · Tổng lượt gọi').nextSibling).toHaveTextContent('0');
  await user.click(screen.getByRole('button', { name: 'Backend đã tắt' }));
  expect(screen.getByText(/HTTP 502 \| 2329 ms/)).toBeInTheDocument();
  expect(screen.getByText('Tổng quan · Lượt lỗi').nextSibling).toHaveTextContent('1');
  await user.click(screen.getByRole('button', { name: 'Làm lại' }));
  expect(screen.getByRole('button', { name: 'Chạy backend' })).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('sơ đồ hướng dẫn tương tác được, có nhãn minh họa và bảng mã lỗi theo contract', async () => {
  const user = userEvent.setup(); renderApp(new MockProvider(), '/portal');
  await user.click(screen.getByRole('button', { name: /Lambda authorizer/ }));
  expect(screen.getByText(/Request bị từ chối ở đây không ghi telemetry/)).toBeInTheDocument();
  expect(screen.getByText('Minh họa, không phải trạng thái thật')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Giả sử Singapore lỗi' }));
  expect(screen.getByText('Health check lỗi')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Thiếu API key' }));
  await user.click(screen.getByRole('button', { name: 'Từng bước' }));
  await user.click(screen.getByRole('button', { name: 'Từng bước' }));
  await user.click(screen.getByRole('button', { name: 'Từng bước' }));
  expect(screen.getByText('Bước 3/4: API Gateway từ chối')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Từng bước' }));
  expect(screen.getByText('HTTP 401 · Dừng ở API Gateway')).toBeInTheDocument();
  for (const code of ['KEY_REVOKED', 'KEY_SCOPE_DENIED', 'API_DISABLED', 'TARGET_BLOCKED', 'PAYLOAD_TOO_LARGE', 'UPSTREAM_TOO_LARGE', 'GATEWAY_INTERNAL']) expect(screen.getByText(code)).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});
