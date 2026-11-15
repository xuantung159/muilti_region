import { beforeEach, afterEach, vi } from 'vitest';
import { TOKEN_KEY } from '../portal/client';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { MonitoringProvider } from '../data/provider';
import { MockProvider, NotConnectedProvider } from '../data/providers';
import { renderApp } from '../test/render';

const mock = () => new MockProvider(0, () => Date.UTC(2026, 9, 13, 5, 7, 30));

describe('System Overview', () => {
  it('ghi rõ DEMO DATA khi dùng dữ liệu mẫu', async () => {
    renderApp(mock());
    expect(await screen.findByText('Tổng request')).toBeInTheDocument();
    expect(screen.getByText('DEMO DATA.')).toBeInTheDocument();
    expect(screen.getAllByText('Mock data').length).toBeGreaterThan(0);
    expect(screen.getByText(/không chứng minh Route 53/)).toBeInTheDocument();
  });

  it('khi chưa kết nối thì không hiện Healthy và không hiện số liệu', async () => {
    renderApp(new NotConnectedProvider());
    expect(await screen.findByText('Tổng request')).toBeInTheDocument();
    expect(screen.queryByText('Healthy')).not.toBeInTheDocument();
    expect(screen.getAllByText('Unknown').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Not connected').length).toBeGreaterThan(5);
    expect(screen.getByText('chưa có dữ liệu')).toBeInTheDocument();
  });

  it('backend live chưa có request /proxy (tài khoản vừa đăng ký) thì hiện 0, không hiện nhãn mock', async () => {
    const base = new NotConnectedProvider();
    const zero = { kind: 'value', value: 0 } as const;
    const live: MonitoringProvider = {
      id: 'http',
      getSnapshot: async (range) => {
        const snapshot = await base.getSnapshot(range);
        return {
          ...snapshot,
          generatedAt: Date.UTC(2026, 10, 10, 3, 0),
          // Stage vẫn có traffic health check/portal, nhưng request người dùng bằng 0.
          regions: snapshot.regions.map((r) => ({ ...r, requests: zero, apiGateway: { ...r.apiGateway, requests: { kind: 'value', value: 120 } } })),
        };
      },
      getEndpoints: () => base.getEndpoints(),
      getIncidents: () => base.getIncidents(),
      getSources: () => base.getSources(),
      getRoutes: () => base.getRoutes(),
    };
    renderApp(live);
    const kpi = (await screen.findByText('Tổng request')).parentElement!;
    expect(within(kpi).getByText('0')).toBeInTheDocument();
    expect(within(kpi).getByText(/Không gồm health check/)).toBeInTheDocument();
    expect(screen.queryByText('DEMO DATA.')).not.toBeInTheDocument();
    expect(screen.queryByText('Mock data')).not.toBeInTheDocument();
    expect(screen.getByText('Live · backend')).toBeInTheDocument();
  });

  it('hiện trạng thái lỗi kèm nút thử lại khi nguồn dữ liệu hỏng', async () => {
    const base = new NotConnectedProvider();
    const broken: MonitoringProvider = {
      id: 'http',
      getSnapshot: () => Promise.reject(new Error('Backend trả HTTP 503')),
      getEndpoints: () => base.getEndpoints(),
      getIncidents: () => base.getIncidents(),
      getSources: () => base.getSources(),
      getRoutes: () => base.getRoutes(),
    };
    renderApp(broken);
    expect(await screen.findByText('Không tải được dữ liệu')).toBeInTheDocument();
    expect(screen.getByText('Backend trả HTTP 503')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
  });
});

describe('điều hướng', () => {
  it('đi được tới cả sáu trang từ sidebar', async () => {
    const user = userEvent.setup();
    renderApp(mock());
    const nav = screen.getByRole('navigation', { name: 'Điều hướng chính' });
    const pages = [
      ['Multi-Region', 'Multi-Region Monitoring'],
      ['Lỗi & timeout', 'Lỗi & timeout'],
      ['API Monitoring', 'API Monitoring'],
      ['Failover & Incidents', 'Failover & Incidents'],
      ['Hạ tầng', 'Hạ tầng triển khai'],
      ['Data Sources', 'Data Sources & Integration Status'],
      ['Settings', 'Settings'],
      ['System Overview', 'System Overview'],
    ];
    for (const [link, heading] of pages) {
      await user.click(within(nav).getByRole('link', { name: link }));
      expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
    }
  });
});

describe('Multi-Region', () => {
  it('hiện Not configured cho metric chưa có nguồn và chọn được từng Region', async () => {
    const user = userEvent.setup();
    renderApp(mock(), '/regions');
    expect(await screen.findByText('S3 replication lag (gửi đi)')).toBeInTheDocument();
    expect(screen.getAllByText('Not configured')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Tokyo' }));
    expect(screen.getAllByText('Not configured')).toHaveLength(1);
    for (const table of screen.getAllByRole('table')) expect(within(table).queryByText('ap-southeast-1')).not.toBeInTheDocument();
  });

  it('key mới tạo: traffic của doanh nghiệp bằng 0, số liệu hạ tầng dùng chung tách riêng kèm giải thích health check', async () => {
    const base = new NotConnectedProvider();
    const v = (n: number) => ({ kind: 'value', value: n }) as const;
    const live: MonitoringProvider = {
      id: 'http',
      getSnapshot: async (range) => {
        const snapshot = await base.getSnapshot(range);
        return {
          ...snapshot,
          generatedAt: Date.UTC(2026, 10, 10, 3, 0),
          regions: snapshot.regions.map((r) => ({
            ...r,
            requests: v(0),
            lambda: { ...r.lambda, invocations: v(11097) },
            apiGateway: { requests: v(11092), error4xx: v(3), error5xx: v(0), healthCheckRequests: v(10800), proxyRequests: v(200) },
          })),
        };
      },
      getEndpoints: () => base.getEndpoints(),
      getIncidents: () => base.getIncidents(),
      getSources: () => base.getSources(),
      getRoutes: () => base.getRoutes(),
    };
    vi.stubGlobal('fetch', async (url: string) => new Response(JSON.stringify(String(url).endsWith('/api/me') ? { role: 'admin' } : { keys: [{ status: 'active' }] }), { headers: { 'Content-Type': 'application/json' } }));
    renderApp(live, '/regions');
    const tenant = await screen.findByRole('table', { name: 'Traffic của doanh nghiệp bạn' });
    await screen.findByRole('table', { name: 'Hạ tầng dùng chung toàn hệ thống' });
    const shared = screen.getByRole('table', { name: 'Hạ tầng dùng chung toàn hệ thống' });
    expect(within(tenant).getAllByText('0')).toHaveLength(2);
    expect(within(tenant).queryByText('11.097')).not.toBeInTheDocument();
    expect(screen.getByText(/Chưa có request nào qua API key này/)).toBeInTheDocument();
    expect(screen.getByText('Đây không phải lưu lượng của key bạn.')).toBeInTheDocument();
    expect(within(shared).getAllByText('11.097')).toHaveLength(2);
    expect(within(shared).getAllByText('10.800')).toHaveLength(2);
    expect(within(shared).getAllByText('92')).toHaveLength(2); // còn lại: 11092 - 10800 - 200
  });

  it('người dùng không phải admin không thấy phần hạ tầng dùng chung', async () => {
    const base = new NotConnectedProvider();
    renderApp({ ...base, id: 'http', getSnapshot: (range) => base.getSnapshot(range) } as MonitoringProvider, '/regions');
    expect(await screen.findByRole('table', { name: 'Traffic của doanh nghiệp bạn' })).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Hạ tầng dùng chung toàn hệ thống' })).not.toBeInTheDocument();
    expect(screen.getByText(/chỉ hiển thị cho tài khoản quản trị/)).toBeInTheDocument();
  });
});

describe('API Monitoring', () => {
  it('lọc theo Region, method, trạng thái và từ khóa', async () => {
    const user = userEvent.setup();
    renderApp(mock(), '/apis');
    expect(await screen.findByText('Hiển thị 12 trên 12 dòng.')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Region'), 'ap-northeast-1');
    expect(screen.getByText('Hiển thị 6 trên 12 dòng.')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Method'), 'POST');
    expect(screen.getByText('Hiển thị 2 trên 12 dòng.')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Trạng thái'), 'degraded');
    expect(screen.getByText('Hiển thị 2 trên 12 dòng.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Tìm endpoint'), 'tenants');
    expect(screen.getByText('Hiển thị 1 trên 12 dòng.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Tìm endpoint'), 'zzz');
    expect(screen.getByText('Không có endpoint nào khớp bộ lọc')).toBeInTheDocument();
  });

  it('hiện empty state khi chưa có endpoint nào', async () => {
    renderApp(new NotConnectedProvider(), '/apis');
    expect(await screen.findByText('Chưa có dữ liệu endpoint')).toBeInTheDocument();
  });
});

describe('Failover & Incidents', () => {
  it('phân biệt nguồn gốc sự kiện và không coi mô phỏng là thật', async () => {
    const user = userEvent.setup();
    renderApp(mock(), '/incidents');
    expect(await screen.findByText('Tỷ lệ lỗi 5xx tăng tại Tokyo')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'AWS' }));
    expect(screen.getByText(/Chưa có sự kiện nào thu thập từ AWS/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Manual test' }));
    expect(screen.getByText(/Chưa có kết quả kiểm thử thủ công/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Simulated' }));
    await user.click(screen.getByRole('button', { name: /Kiểm thử failover: Singapore/ }));
    expect(screen.getByText('(giá trị mô phỏng)')).toBeInTheDocument();
  });
});

describe('Data Sources', () => {
  it('đánh dấu mọi nguồn AWS là Not connected ở chế độ demo', async () => {
    renderApp(mock(), '/sources');
    expect(await screen.findByText('CloudWatch Alarms')).toBeInTheDocument();
    expect(screen.getAllByText('Not connected')).toHaveLength(7);
    expect(screen.getAllByText('Mock')).toHaveLength(1);
    expect(screen.getByText(/0 trên 7/)).toBeInTheDocument();
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
  });
});

describe('Hạ tầng', () => {
  it('liệt kê tài nguyên hai Region và nêu rõ trạng thái sống chưa có khi chưa kết nối', async () => {
    renderApp(new NotConnectedProvider(), '/infrastructure');
    expect(await screen.findByRole('heading', { level: 1, name: 'Hạ tầng triển khai' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Singapore (ap-southeast-1)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tokyo (ap-northeast-1)' })).toBeInTheDocument();
    expect((await screen.findAllByText('Health check: chưa có dữ liệu')).length).toBe(2);
    expect(screen.queryByText('Health check OK')).not.toBeInTheDocument();
    expect(screen.getByText('mrapi-api-tyo (n39r5pits8), stage demo')).toBeInTheDocument();
  });
});

beforeEach(() => { sessionStorage.setItem(TOKEN_KEY, 'a'.repeat(64)); vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ keys: [{ status: 'active' }] }), { headers: { 'Content-Type': 'application/json' } })); });
afterEach(() => { sessionStorage.clear(); vi.unstubAllGlobals(); });

it('mở được hướng dẫn tích hợp đã đóng gói và giải thích trạng thái Connected', async () => {
  const user = userEvent.setup();
  renderApp(new NotConnectedProvider(), '/sources');
  expect(await screen.findByText('Data Sources & Integration Status')).toBeInTheDocument();
  const guide = await screen.findByText('Mở hướng dẫn API Gateway');
  await user.click(guide);
  expect(guide.closest('details')).toHaveAttribute('open');
  expect(guide.closest('details')?.querySelector('pre')?.textContent).toContain('API Gateway');
  expect(screen.queryByText('Cấu hình còn thiếu')).not.toBeInTheDocument();
});
