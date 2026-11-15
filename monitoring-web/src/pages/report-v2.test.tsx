import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MonitoringProvider } from '../data/provider';
import { mergeReport, MockProvider, NotConnectedProvider, type TenantReport } from '../data/providers';
import { formatMs } from '../domain/format';
import type { RegionFilter } from '../domain/types';
import { TOKEN_KEY } from '../portal/client';
import { buildReportV2, toV1 } from '../test/fixtures/report';
import { renderApp } from '../test/render';

const NOW = Date.UTC(2026, 10, 13, 5, 7, 30);

// Provider "live" ghép số liệu hạ tầng (chưa kết nối) với báo cáo /api/report dựng sẵn, giống HttpProvider.
function live(make: (region: RegionFilter) => TenantReport) {
  const base = new NotConnectedProvider();
  const getSnapshot = vi.fn(async (range: Parameters<MonitoringProvider['getSnapshot']>[0], _key?: string, region: RegionFilter = 'all') =>
    mergeReport(await base.getSnapshot(range), make(region)),
  );
  const provider: MonitoringProvider = {
    id: 'http',
    getSnapshot,
    getEndpoints: () => base.getEndpoints(),
    getIncidents: () => base.getIncidents(),
    getSources: () => base.getSources(),
    getRoutes: () => base.getRoutes(),
  };
  return { provider, getSnapshot };
}

const v2 = (region: RegionFilter = 'all') => {
  const r = buildReportV2('6h', NOW, region);
  // p95 gộp khác hẳn max p95 các Region để thấy KPI không lấy max.
  r.totals = { ...r.totals!, latency: { ...r.totals!.latency, p95Ms: 777 } };
  return r;
};

const kpiCard = (label: string) => screen.getAllByText(label).map((el) => el.closest('section')!).find((s) => s.firstElementChild?.textContent === label)!;

describe('System Overview với /api/report mới', () => {
  it('KPI p95 dùng p95 gộp (totals), không phải max p95 các Region', async () => {
    renderApp(live(() => v2()).provider);
    await screen.findByText('Tổng request');
    const p95 = screen.getAllByText('Latency p95').map((el) => el.parentElement!).find((el) => el.textContent?.includes(formatMs(777)));
    expect(p95).toBeDefined();
    expect(screen.queryByText('Latency p95 (cận trên)')).not.toBeInTheDocument();
    expect(screen.getByText(/Health phản ánh Route 53 health check/)).toBeInTheDocument();
    expect(screen.getByText('Độ trễ: gateway và upstream')).toBeInTheDocument();
    expect(screen.getByText(/Thời gian chờ upstream gồm thời gian backend/)).toBeInTheDocument();
    expect(screen.getAllByText(/mẫu$/).length).toBeGreaterThan(0);
  });

  it('backend cũ: p95 ghi rõ là cận trên, trường không có hiện N/A thay vì 0', async () => {
    renderApp(live(() => toV1(v2())).provider);
    await screen.findByText('Tổng request');
    const card = kpiCard('Latency p95 (cận trên)');
    expect(within(card).getByText('≤')).toBeInTheDocument();
    expect(within(card).getByText(/không phải p95 thật/i)).toBeInTheDocument();
    for (const name of ['Singapore', 'Tokyo']) {
      const stats = screen.getByRole('group', { name: `Số liệu ${name}` });
      for (const label of ['Tỷ lệ 4xx', 'Latency p99', 'Timeout']) expect(within(within(stats).getByText(label).parentElement!).getByText('N/A')).toBeInTheDocument();
    }
    expect(within(kpiCard('Latency p99')).getByText('N/A')).toBeInTheDocument();
    expect(screen.getByText(/Backend chưa trả thời gian tách gateway\/upstream/)).toBeInTheDocument();
  });

  it('bộ lọc Region gửi tham số region và KPI ghi rõ phạm vi', async () => {
    const user = userEvent.setup();
    const { provider, getSnapshot } = live(v2);
    renderApp(provider);
    await screen.findByText('Tổng request');
    await user.selectOptions(screen.getByLabelText('Region'), 'ap-northeast-1');
    expect(await screen.findByText(/chỉ tính request do Tokyo phục vụ/)).toBeInTheDocument();
    expect(getSnapshot).toHaveBeenLastCalledWith('6h', 'all', 'ap-northeast-1');
  });
});

describe('Lỗi & timeout', () => {
  it('hiện lỗi theo Region, loại lỗi, lỗi theo key; 4xx không dùng nhãn sự cố', async () => {
    renderApp(new MockProvider(0, () => NOW), '/errors');
    const byRegion = await screen.findByRole('table', { name: 'Lỗi theo Region' });
    expect(within(byRegion).getByText('Singapore')).toBeInTheDocument();
    const types = screen.getByRole('table', { name: 'Loại lỗi thường gặp' });
    expect(within(types).getAllByText('UPSTREAM_TIMEOUT').length).toBeGreaterThan(0);
    const keys = screen.getByRole('table', { name: 'Tỷ lệ lỗi theo API key' });
    expect(within(keys).getByText('Key mẫu: web')).toBeInTheDocument();
    // 4xx: nhãn trung tính; 5xx/timeout: tag critical.
    for (const el of byRegion.querySelectorAll('[data-family="4xx"]')) expect(el.querySelector('.border-critical')).toBeNull();
    expect(byRegion.querySelectorAll('[data-family="5xx"] .border-critical').length).toBe(4);
    expect(screen.getAllByText('Mock data').length).toBeGreaterThan(0);
  });

  it('backend cũ: bảng mới hiện N/A, không bịa số', async () => {
    renderApp(live(() => toV1(v2())).provider, '/errors');
    expect(await screen.findByText(/Backend chưa trả danh sách loại lỗi/)).toBeInTheDocument();
    expect(screen.getByText(/Backend chưa trả lỗi theo API key/)).toBeInTheDocument();
    expect(screen.getByText(/Backend chưa trả số timeout theo ô thời gian/)).toBeInTheDocument();
    const byRegion = screen.getByRole('table', { name: 'Lỗi theo Region' });
    expect(within(byRegion).getAllByText('N/A').length).toBe(2 * 7); // timeout + 6 errorClass cho mỗi Region
  });
});

describe('Multi-Region: bảng so sánh và khoảng trống', () => {
  it('có p99, 4xx, timeout và lời nhắc không kết luận kiến trúc', async () => {
    renderApp(live(() => v2()).provider, '/regions');
    const table = await screen.findByRole('table', { name: 'Traffic của doanh nghiệp bạn' });
    for (const label of ['Latency p99 (gồm backend)', 'Lỗi 4xx', 'Timeout backend (số request)']) expect(within(table).getByText(label)).toBeInTheDocument();
    expect(screen.getByText(/Không đủ để kết luận về kiến trúc/)).toBeInTheDocument();
  });

  it('ô không có request vẽ thành khoảng trống (N/A trong bảng), ô đang thu thập được đánh dấu', async () => {
    const user = userEvent.setup();
    const report = () => {
      const r = v2();
      const last = r.series.length - 1;
      const b = r.series[3].regions['ap-northeast-1'];
      r.series[3].regions['ap-northeast-1'] = { ...b, requests: 0, success: 0, error4xx: 0, error5xx: 0, hasData: false, latency: null, latencyAvgMs: 0, latencyP95Ms: 0 };
      r.series[last] = { ...r.series[last], partial: true };
      return r;
    };
    renderApp(live(report).provider, '/regions');
    const chart = (await screen.findByRole('heading', { name: 'Latency p95 (traffic của bạn)' })).closest('section')!;
    expect(within(chart).getByText('Khoảng trống = không có dữ liệu')).toBeInTheDocument();
    expect(within(chart).getByText(/Ô cuối đang thu thập/)).toBeInTheDocument();
    await user.click(within(chart).getByRole('button', { name: 'Xem bảng' }));
    expect(within(chart).getAllByText('N/A')).toHaveLength(1);
    expect(within(chart).getByText('(đang thu thập)')).toBeInTheDocument();
    expect(within(chart).queryByText('0 ms')).not.toBeInTheDocument();
  });
});

beforeEach(() => {
  sessionStorage.setItem(TOKEN_KEY, 'a'.repeat(64));
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ keys: [{ keyId: 'aaaaaaaaaaaa', name: 'k', status: 'active' }] }), { headers: { 'Content-Type': 'application/json' } }));
});
afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
});
