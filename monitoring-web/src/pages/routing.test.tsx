import { beforeEach, afterEach, vi } from 'vitest';
import { TOKEN_KEY } from '../portal/client';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { REGION_COLOR, REQUEST_COLOR } from '../components/RoutingMap';
import type { MonitoringProvider } from '../data/provider';
import { MockProvider, NotConnectedProvider } from '../data/providers';
import { validRoutes } from '../data/validation';
import { renderApp } from '../test/render';

const mock = () => new MockProvider(0, () => Date.UTC(2026, 10, 10, 12, 0));

describe('Định tuyến theo vị trí', () => {
  it('tô vàng quốc gia gửi request, chấm xanh Region phục vụ và liệt kê tuyến', async () => {
    const live: MonitoringProvider = {
      ...new NotConnectedProvider(),
      id: 'http',
      getSnapshot: () => new NotConnectedProvider().getSnapshot('1h'),
      getEndpoints: async () => [],
      getIncidents: async () => [],
      getSources: async () => [],
      getRoutes: async () => [
        { country: 'US', servedRegion: 'ap-northeast-1', requests: 20, lastSeen: 0 },
        { country: 'VN', servedRegion: 'ap-southeast-1', requests: 11, lastSeen: 0 },
      ],
    };
    const { container } = renderApp(live, '/routing');
    expect(await screen.findByRole('heading', { name: 'Định tuyến theo vị trí' })).toBeInTheDocument();

    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getByText('(US)')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Tokyo')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Singapore')).toBeInTheDocument();

    // Bản đồ tải world-atlas bất đồng bộ.
    await waitFor(() => expect(container.querySelector('path[data-country="VN"]')).not.toBeNull(), { timeout: 5000 });
    expect(container.querySelector('path[data-country="VN"]')!.getAttribute('fill')).toBe(REQUEST_COLOR);
    expect(container.querySelector('path[data-country="US"]')!.getAttribute('fill')).toBe(REQUEST_COLOR);
    expect(container.querySelector('path[data-country="FR"]')!.getAttribute('fill')).not.toBe(REQUEST_COLOR);
    expect(container.querySelectorAll(`circle[r="8"][fill="${REGION_COLOR}"]`)).toHaveLength(2);
    expect(container.querySelectorAll('path.route-arc')).toHaveLength(2);
    expect(screen.queryByText('Dữ liệu minh họa')).not.toBeInTheDocument();
  });

  it('dữ liệu mẫu được gắn nhãn minh họa', async () => {
    renderApp(mock(), '/routing');
    expect(await screen.findByText('Dữ liệu minh họa')).toBeInTheDocument();
  });

  it('chưa có request thì hiện hướng dẫn, không vẽ tuyến', async () => {
    renderApp(new NotConnectedProvider(), '/routing');
    expect(await screen.findByText('Chưa có request nào trong khoảng thời gian này')).toBeInTheDocument();
  });

  it('chọn API key thì báo cáo chỉ lấy request của key đó', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ keys: [
      { keyId: 'aaaaaaaaaaaa', name: 'project_test', status: 'active' },
      { keyId: 'bbbbbbbbbbbb', name: 'App cũ', status: 'revoked' },
    ] }), { headers: { 'Content-Type': 'application/json' } }));
    const calls: (string | undefined)[] = [];
    const live: MonitoringProvider = {
      ...new NotConnectedProvider(),
      id: 'http',
      getSnapshot: () => new NotConnectedProvider().getSnapshot('1h'),
      getEndpoints: async () => [],
      getIncidents: async () => [],
      getSources: async () => [],
      getRoutes: async (_range, keyId) => {
        calls.push(keyId);
        return keyId === 'aaaaaaaaaaaa' ? [{ country: 'JP', servedRegion: 'ap-northeast-1', requests: 5, lastSeen: 0 }] : [];
      },
    };
    renderApp(live, '/routing');
    const select = await screen.findByLabelText('API key');
    expect(await within(select).findByRole('option', { name: 'App cũ (đã thu hồi)' })).toBeInTheDocument();
    await userEvent.selectOptions(select, 'aaaaaaaaaaaa');
    expect(await screen.findByText('(JP)')).toBeInTheDocument();
    expect(calls).toContain('all');
    expect(calls.at(-1)).toBe('aaaaaaaaaaaa');
  });

  it('dữ liệu mẫu không chia theo key nên không hiện bộ chọn API key', async () => {
    renderApp(mock(), '/routing');
    await screen.findByText('Dữ liệu minh họa');
    expect(screen.queryByLabelText('API key')).not.toBeInTheDocument();
  });

  it('validRoutes chỉ nhận mã quốc gia 2 chữ và Region của hệ thống', () => {
    expect(validRoutes([{ country: 'VN', servedRegion: 'ap-southeast-1', requests: 1, lastSeen: 0 }])).toBe(true);
    expect(validRoutes([{ country: 'vn', servedRegion: 'ap-southeast-1', requests: 1, lastSeen: 0 }])).toBe(false);
    expect(validRoutes([{ country: 'VN', servedRegion: 'eu-west-1', requests: 1, lastSeen: 0 }])).toBe(false);
    expect(validRoutes([{ country: 'VN', servedRegion: 'ap-southeast-1', requests: '1', lastSeen: 0 }])).toBe(false);
  });
});

beforeEach(() => { sessionStorage.setItem(TOKEN_KEY, 'a'.repeat(64)); vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ keys: [{ status: 'active' }] }), { headers: { 'Content-Type': 'application/json' } })); });
afterEach(() => { sessionStorage.clear(); vi.unstubAllGlobals(); });
