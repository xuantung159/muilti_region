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

  it('hiện trạng thái lỗi kèm nút thử lại khi nguồn dữ liệu hỏng', async () => {
    const base = new NotConnectedProvider();
    const broken: MonitoringProvider = {
      id: 'http',
      getSnapshot: () => Promise.reject(new Error('Backend trả HTTP 503')),
      getEndpoints: () => base.getEndpoints(),
      getIncidents: () => base.getIncidents(),
      getSources: () => base.getSources(),
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
      ['API Monitoring', 'API Monitoring'],
      ['Failover & Incidents', 'Failover & Incidents'],
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
    expect(within(screen.getByRole('table')).queryByText('ap-southeast-1')).not.toBeInTheDocument();
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
    expect(await screen.findByText('AWS CloudWatch')).toBeInTheDocument();
    expect(screen.getAllByText('Not connected')).toHaveLength(6);
    expect(screen.getAllByText('Mock')).toHaveLength(1);
    expect(screen.getByText(/0 trên 6/)).toBeInTheDocument();
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
  });
});
