import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeoDemo, type GeoResult } from './GeoDemo';

const token = 'a'.repeat(64);
const catalog = {
  record: 'api.multi-region.io.vn', hostedZoneId: 'Z03093462BF2L4GV4FGRD', portalRegion: 'ap-southeast-1',
  servingRegions: ['ap-southeast-1', 'ap-northeast-1'],
  countries: [
    { code: 'DE', name: 'Đức', city: 'Frankfurt', ip: '3.78.206.104', live: false },
    { code: 'KR', name: 'Hàn Quốc', city: 'Seoul', ip: '43.202.71.241', live: false },
  ],
};
const resultFor = (country: string): GeoResult => {
  const tokyo = country === 'KR';
  const region = tokyo ? 'ap-northeast-1' : 'ap-southeast-1';
  return {
    country, countryName: tokyo ? 'Hàn Quốc' : 'Đức', city: '', resolverIp: '1.2.3.4', ecsSubnet: '1.2.3.0/24',
    dnsAnswer: ['18.139.143.59'], chosenRegion: region, chosenBy: 'endpoint-ip', servedRegion: region,
    status: 200, latencyMs: 123, match: true, portalRegion: 'ap-southeast-1', live: null, testedAt: '2026-11-11T00:00:00Z',
    steps: [
      { id: 'dns', kind: 'simulated', ok: true, ms: 80, title: 'Route 53 TestDNSAnswer (mô phỏng DNS)', detail: 'Resolver 1.2.3.4 → NOERROR' },
      { id: 'request', kind: 'real', ok: true, ms: 123, title: 'Request HTTPS thật tới 18.139.143.59', detail: `X-Served-Region: ${region}` },
    ],
  };
};

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
  if ((init?.method ?? 'GET') === 'GET') return jsonResponse(catalog);
  const { country } = JSON.parse(String(init!.body));
  return jsonResponse(resultFor(country));
});

beforeEach(() => { fetchMock.mockClear(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe('GeoDemo', () => {
  it('yêu cầu đăng nhập và không gọi API khi chưa có token', () => {
    render(<GeoDemo token={null} />);
    expect(screen.getByText('Cần đăng nhập để chạy demo')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gửi request cho nước đã chọn và hiển thị các bước, ghi rõ phần mô phỏng', async () => {
    render(<GeoDemo token={token} />);
    const select = await screen.findByLabelText('Nước');
    await userEvent.selectOptions(select, 'KR');
    await userEvent.click(screen.getByRole('button', { name: /Gửi request/ }));

    const result = await screen.findByTestId('geo-result');
    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toMatch(/\/api\/demo\/geo$/);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ country: 'KR' });
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${token}`);

    const steps = within(within(result).getByRole('list', { name: 'Các bước' })).getAllByRole('listitem');
    expect(steps).toHaveLength(2);
    expect(within(steps[0]).getByText('Mô phỏng DNS')).toBeInTheDocument();
    expect(within(steps[1]).getByText('Thật')).toBeInTheDocument();
    expect(within(result).getAllByText('Tokyo (ap-northeast-1)')).toHaveLength(2);
    expect(within(result).getByText('Khớp')).toBeInTheDocument();
  });

  it('chạy tất cả các nước tuần tự và lập bảng tổng hợp', async () => {
    render(<GeoDemo token={token} />);
    await userEvent.click(await screen.findByRole('button', { name: /Chạy tất cả các nước/ }));
    const heading = await screen.findByText('Tổng hợp nước → Region');
    const table = within(heading.parentElement!).getByRole('table');
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(3));
    const rows = within(table).getAllByRole('row');
    expect(within(rows[1]).getAllByText('Singapore')).toHaveLength(2);
    expect(within(rows[2]).getAllByText('Tokyo')).toHaveLength(2);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2);
  });

  it('báo lỗi khi máy chủ từ chối', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      (init?.method ?? 'GET') === 'GET' ? jsonResponse(catalog) : jsonResponse({ error: 'Nước không có trong danh sách demo' }, 400));
    render(<GeoDemo token={token} />);
    await userEvent.click(await screen.findByRole('button', { name: /Gửi request/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nước không có trong danh sách demo');
  });
});
