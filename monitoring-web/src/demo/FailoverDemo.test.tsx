import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { changesBetween, FailoverDemo, type FailoverStatus } from './FailoverDemo';

const SG = 'ap-southeast-1' as const;
const TYO = 'ap-northeast-1' as const;
const token = 'a'.repeat(64);
const T0 = Date.parse('2026-11-11T03:00:00Z');

function status(overrides: Partial<FailoverStatus> = {}): FailoverStatus {
  return {
    region: SG,
    now: new Date(T0).toISOString(),
    outage: null,
    cooldown: null,
    lastOutage: null,
    phase: 'idle',
    canStart: true,
    blockedReason: null,
    quota: { used: 0, max: 5 },
    limits: { defaultMinutes: 5, minMinutes: 3, maxMinutes: 10, cooldownMinutes: 3, dailyPerTenant: 5 },
    healthChecks: [
      { region: SG, status: 'healthy', okCheckers: 8, totalCheckers: 8 },
      { region: TYO, status: 'healthy', okCheckers: 8, totalCheckers: 8 },
    ],
    dns: [
      { id: 'vn', label: 'Việt Nam (DNS Viettel)', resolverIp: '203.113.131.1', expectedRegion: SG, answerIps: ['13.0.0.1'], answeredRegion: SG },
      { id: 'kr', label: 'Hàn Quốc (Seoul)', resolverIp: '43.202.71.241', expectedRegion: TYO, answerIps: ['54.0.0.1'], answeredRegion: TYO },
    ],
    probe: { from: SG, ip: '13.0.0.1', status: 200, servedRegion: SG, latencyMs: 20 },
    observedAt: new Date(T0).toISOString(),
    timeline: [{ key: 'unhealthy', label: 'Route 53 health check chuyển Unhealthy', fromSeconds: 60, toSeconds: 90, after: 'start' }],
    ...overrides,
  };
}

const outage = { region: SG, regionName: 'Singapore', startedAt: new Date(T0).toISOString(), until: new Date(T0 + 300_000).toISOString(), endedEarlyAt: null, startedByMe: true };
let current: FailoverStatus;
const requests: { method: string; body: unknown }[] = [];
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  expect(url).toMatch(/\/api\/demo\/failover$/);
  expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${token}`);
  const method = init?.method ?? 'GET';
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  requests.push({ method, body });
  if (method === 'POST') current = status({ outage: { ...outage, remainingSeconds: 300 }, phase: 'waiting_unhealthy', canStart: false, blockedReason: 'Đang giả lập', quota: { used: 1, max: 5 } });
  if (method === 'DELETE') current = status({ lastOutage: { ...outage, endedEarlyAt: new Date(T0).toISOString() }, cooldown: { until: new Date(T0 + 180_000).toISOString(), remainingSeconds: 180 }, phase: 'cooldown', canStart: false });
  return new Response(JSON.stringify(current), { status: method === 'POST' ? 201 : 200, headers: { 'Content-Type': 'application/json' } });
});

beforeEach(() => { current = status(); requests.length = 0; fetchMock.mockClear(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); });

it('chưa đăng nhập thì báo cần đăng nhập và không gọi API', () => {
  render(<FailoverDemo token={null} />);
  expect(screen.getByText('Cần đăng nhập')).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('bật giả lập có xác nhận, thấy request chuyển Region trong nhật ký, rồi kết thúc sớm', async () => {
  const user = userEvent.setup();
  render(<FailoverDemo token={token} />);
  expect(await screen.findByTestId('probe')).toHaveTextContent('X-Served-Region: ap-southeast-1');
  expect(screen.getByTestId(`health-${SG}`)).toHaveTextContent('Healthy');
  expect(screen.getByRole('note')).toHaveTextContent('tự phục hồi');

  await user.selectOptions(screen.getByLabelText('Thời lượng'), '4');
  await user.click(screen.getByRole('button', { name: 'Bắt đầu giả lập' }));
  await user.click(screen.getByRole('button', { name: /Xác nhận làm lỗi Singapore/ }));
  expect(requests.find((r) => r.method === 'POST')?.body).toEqual({ region: SG, minutes: 4 });
  expect(await screen.findByText('Singapore (ap-southeast-1)')).toBeInTheDocument();
  expect(screen.getByLabelText('Thời gian còn lại')).toBeInTheDocument();

  // Route 53 thấy Singapore lỗi và chuyển sang Tokyo.
  current = status({
    now: new Date(T0 + 150_000).toISOString(),
    outage: { ...outage, remainingSeconds: 150 }, phase: 'failed_over', canStart: false,
    healthChecks: [{ region: SG, status: 'unhealthy', okCheckers: 0, totalCheckers: 8 }, { region: TYO, status: 'healthy', okCheckers: 8, totalCheckers: 8 }],
    dns: current.dns.map((d) => ({ ...d, answeredRegion: TYO, answerIps: ['54.0.0.1'] })),
    probe: { from: SG, ip: '54.0.0.1', status: 200, servedRegion: TYO, latencyMs: 80 },
  });
  await user.click(screen.getByRole('button', { name: 'Làm mới' }));
  const log = await screen.findByRole('list', { name: 'Nhật ký thay đổi' });
  expect(await within(log).findByText('Request thật chuyển: Singapore → Tokyo phục vụ.')).toBeInTheDocument();
  expect(within(log).getByText('Health check Route 53 của Singapore: Healthy → Unhealthy.')).toBeInTheDocument();
  expect(within(log).getByText('Route 53 trả cho Việt Nam (DNS Viettel): Singapore → Tokyo.')).toBeInTheDocument();
  expect(within(log).getAllByText(/\+02:30/).length).toBeGreaterThan(0);
  expect(screen.getByTestId('dns-vn')).toHaveTextContent('(đã chuyển)');

  await user.click(screen.getByRole('button', { name: 'Kết thúc sớm' }));
  expect(requests.some((r) => r.method === 'DELETE')).toBe(true);
  expect(await screen.findByText(/Kết thúc sớm giả lập ở Singapore/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Bắt đầu giả lập' })).toBeDisabled();
});

it('hiển thị lỗi từ máy chủ khi không bật được', async () => {
  const user = userEvent.setup();
  render(<FailoverDemo token={token} />);
  await screen.findByTestId('probe');
  fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ error: 'Region còn lại (Tokyo) chưa Healthy' }), { status: 409, headers: { 'Content-Type': 'application/json' } }));
  await user.click(screen.getByRole('button', { name: 'Bắt đầu giả lập' }));
  await user.click(screen.getByRole('button', { name: /Xác nhận/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('chưa Healthy');
});

it('changesBetween không sinh dòng khi không có gì đổi', () => {
  const a = status();
  expect(changesBetween(a, status())).toEqual([]);
  expect(changesBetween(null, a)[0]).toMatch(/Singapore phục vụ/);
});

it('không tính nhật ký idle từ sự cố cũ đã kết thúc', async () => {
  current = status({ now: new Date(T0 + 86_400_000).toISOString(), lastOutage: outage });
  render(<FailoverDemo token={token} />);
  const log = await screen.findByRole('list', { name: 'Nhật ký thay đổi' });
  expect(log).toHaveTextContent('Bắt đầu theo dõi');
  expect(log.textContent).not.toContain('+');
});
