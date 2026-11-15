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
let role: 'admin' | undefined;
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  const path = url.replace(/^.*\/api\//, '');
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  const method = init?.method ?? 'GET';
  const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  if (path === 'login' || path === 'signup') return reply({ ...account, token });
  if (path === 'logout') return reply({});
  if (expired) return reply({ error: 'Phiên đã hết hạn' }, 401);
  if (path === 'me') return reply(role ? { ...account, role } : account);
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
beforeEach(() => { sessionStorage.clear(); apis = []; keys = []; expired = false; role = undefined; fetchMock.mockClear(); vi.stubGlobal('fetch', fetchMock); });
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

it('hướng dẫn đổi ngôn ngữ cùng project tải xuống và lệnh chạy, giữ nguyên bước', async () => {
  const user = userEvent.setup(); renderApp(new MockProvider(), '/portal');
  await user.click(screen.getByRole('button', { name: /Project mẫu/ }));
  expect(screen.getByRole('link', { name: 'Tải project JavaScript (.zip)' })).toHaveAttribute('href', '/samples/mrapi-javascript.zip');
  await user.click(screen.getByRole('button', { name: 'Java' }));
  expect(screen.getByRole('link', { name: 'Tải project Java (.zip)' })).toHaveAttribute('href', '/samples/mrapi-java.zip');
  await user.click(screen.getByRole('button', { name: /Chạy project$/ }));
  expect(screen.getByText('java Main.java', { selector: 'code' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Python' }));
  expect(screen.getByText('python main.py', { selector: 'code' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'JavaScript' }));
  expect(screen.getByText('node --env-file=.env main.mjs', { selector: 'code' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /^Tham khảo/ }));
  expect(screen.getByRole('heading', { name: '2. Lấy API key' })).toBeInTheDocument();
  expect(screen.getByText(/const response = await fetch/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Python' }));
  expect(screen.getByText(/from urllib.request import Request/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'cURL' }));
  expect(screen.getByText(/curl --fail-with-body/)).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('hướng dẫn chỉ mở bước đang chọn, điều hướng được và không gọi AWS', async () => {
  const user = userEvent.setup();
  renderApp(new MockProvider(), '/portal');
  await user.click(screen.getByRole('button', { name: /Project mẫu/ }));
  expect(screen.getByRole('navigation', { name: 'Các bước tích hợp project' }).querySelectorAll('button')).toHaveLength(8);
  expect(screen.getByRole('button', { name: 'Bước trước' })).toBeDisabled();
  expect(screen.queryByRole('heading', { name: /Đưa cấu hình portal vào file .env/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /Cấu hình .env$/ }));
  expect(screen.getByRole('heading', { name: /Đưa cấu hình portal vào file .env/ })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Go' }));
  await user.click(screen.getByRole('button', { name: 'Bước tiếp' }));
  expect(screen.getByText('go run . /todos/1', { selector: 'code' })).toBeInTheDocument();
  await user.click(screen.getByText(/Kết quả đã kiểm chứng trên AWS/));
  expect(screen.getByText(/Kết quả một lần chạy đã lưu, không phải trạng thái thời gian thực/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Tạo key' })).not.toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('sơ đồ hướng dẫn tương tác được, có nhãn minh họa và bảng mã lỗi theo contract', async () => {
  const user = userEvent.setup(); renderApp(new MockProvider(), '/portal');
  await user.click(screen.getByRole('button', { name: /^Animation/ }));
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
  await user.click(screen.getByRole('button', { name: /^Tham khảo/ }));
  for (const code of ['KEY_REVOKED', 'KEY_SCOPE_DENIED', 'API_DISABLED', 'TARGET_BLOCKED', 'PAYLOAD_TOO_LARGE', 'UPSTREAM_TOO_LARGE', 'GATEWAY_INTERNAL']) expect(screen.getByText(code)).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('tài khoản admin hiện tag Admin và card project mẫu với API Todo demo', async () => {
  sessionStorage.setItem(TOKEN_KEY, token); role = 'admin';
  apis.push(
    { apiId: 'api-todo-1', name: 'API Todo demo', baseUrl: 'https://jsonplaceholder.typicode.com', timeoutMs: 5000, enabled: true },
    { apiId: 'api-todo-2', name: 'API Todo demo (Tokyo)', baseUrl: 'https://jsonplaceholder.typicode.com', timeoutMs: 5000, enabled: true },
    { apiId: 'api-orders', name: 'Orders', baseUrl: 'https://backend.company.com', timeoutMs: 5000, enabled: true },
  );
  const user = userEvent.setup(); renderApp(new MockProvider(), '/portal');
  expect(await screen.findByText(account.orgName)).toBeInTheDocument();
  expect(screen.getAllByText('Admin').length).toBeGreaterThan(0);
  const card = (await screen.findByRole('heading', { name: 'Project mẫu đã tích hợp sẵn' })).closest('section')!;
  expect(card).toHaveTextContent('https://jsonplaceholder.typicode.com');
  expect(card).toHaveTextContent('Project mẫu');
  expect(card).toHaveTextContent(/không bao giờ hiển thị lại/);
  expect(card).toHaveTextContent('api-todo-1');
  expect(card).toHaveTextContent('api-todo-2');
  expect(card).not.toHaveTextContent('api-orders');
  await user.click(screen.getByRole('button', { name: 'Mở hướng dẫn tích hợp' }));
  expect(screen.getByRole('button', { name: 'Hướng dẫn' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByRole('heading', { name: 'Project mẫu đã tích hợp sẵn' })).not.toBeInTheDocument();
});

it('tài khoản thường không có tag Admin hay card project mẫu', async () => {
  sessionStorage.setItem(TOKEN_KEY, token);
  renderApp(new MockProvider(), '/portal');
  expect(await screen.findByText(account.orgName)).toBeInTheDocument();
  expect(await screen.findByText('Tổng lượt gọi')).toBeInTheDocument();
  expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Project mẫu đã tích hợp sẵn' })).not.toBeInTheDocument();
});

it('hướng dẫn mặc định là tích hợp dự án có sẵn: đổi base URL, thêm x-api-key, cảnh báo header bị bỏ', async () => {
  const user = userEvent.setup();
  renderApp(new MockProvider(), '/portal');
  expect(screen.getByRole('heading', { name: 'Đưa API có sẵn ra sau gateway' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /Sau · src\/lib\/ordersClient.js/ })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Python (requests)' }));
  expect(screen.getByRole('heading', { name: /Sau · app\/clients\/orders.py/ })).toBeInTheDocument();
  expect(screen.getByText(/session.headers\['x-api-key'\] = key/)).toBeInTheDocument();
  expect(screen.getAllByText('Authorization').length).toBeGreaterThan(0);
});
