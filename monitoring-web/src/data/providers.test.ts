import { describe, expect, it, vi } from 'vitest';
import { RANGES } from '../domain/range';
import { deriveRegionHealth } from '../domain/status';
import { simulatedIncidentWindow } from './mock/generator';
import { createProvider, HttpProvider, MockProvider, NotConnectedProvider } from './providers';

const NOW = Date.UTC(2026, 9, 13, 5, 7, 30);

describe('MockProvider', () => {
  const provider = new MockProvider(0, () => NOW);

  it('gắn nhãn mock và trả đủ số ô thời gian cho từng khoảng xem', async () => {
    for (const range of ['1h', '6h', '24h', '7d'] as const) {
      const snapshot = await provider.getSnapshot(range);
      expect(snapshot.dataMode).toBe('mock');
      expect(snapshot.series).toHaveLength(RANGES[range].buckets);
      expect(snapshot.series.at(-1)!.t).toBeLessThan(NOW);
    }
  });

  it('cho cùng kết quả khi gọi lại ở cùng thời điểm', async () => {
    expect(await provider.getSnapshot('6h')).toEqual(await provider.getSnapshot('6h'));
  });

  it('số liệu từng ô nhất quán: success + lỗi = request', async () => {
    const { series } = await provider.getSnapshot('24h');
    for (const point of series)
      for (const bucket of Object.values(point.regions)) expect(bucket.success + bucket.error4xx + bucket.error5xx).toBe(bucket.requests);
  });

  it('sự cố mô phỏng làm 5xx của Tokyo tăng trong đúng khung giờ', async () => {
    const { series } = await provider.getSnapshot('6h');
    const { start, end } = simulatedIncidentWindow(NOW);
    const rate = (p: (typeof series)[number]) => p.regions['ap-northeast-1'].error5xx / p.regions['ap-northeast-1'].requests;
    const inside = series.filter((p) => p.t >= start && p.t < end);
    const outside = series.filter((p) => p.t >= end || p.t + RANGES['6h'].bucketMs <= start);
    expect(inside.length).toBeGreaterThan(0);
    expect(Math.min(...inside.map(rate))).toBeGreaterThan(0.1);
    expect(Math.max(...outside.map(rate))).toBeLessThan(0.02);
  });

  it('mọi sự kiện đều mang nhãn simulated và mọi nguồn AWS đều chưa kết nối', async () => {
    expect((await provider.getIncidents()).every((e) => e.origin === 'simulated')).toBe(true);
    const sources = await provider.getSources();
    expect(sources.filter((s) => s.status === 'mock').map((s) => s.id)).toEqual(['mock']);
    expect(sources.filter((s) => s.id !== 'mock').every((s) => s.status === 'not_connected' && s.lastSync === null)).toBe(true);
  });
});

describe('NotConnectedProvider', () => {
  it('không có số liệu nào và không Region nào Healthy', async () => {
    const provider = new NotConnectedProvider();
    const snapshot = await provider.getSnapshot('1h');
    expect(snapshot.generatedAt).toBeNull();
    expect(snapshot.series).toEqual([]);
    expect(snapshot.regions.map(deriveRegionHealth)).toEqual(['unknown', 'unknown']);
    expect(await provider.getEndpoints()).toEqual([]);
    expect(await provider.getIncidents()).toEqual([]);
  });
});

describe('HttpProvider', () => {
  const respond = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));
  const emptySeries = (n: number) => Array.from({ length: n }, (_, k) => ({ t: NOW - (n - k) * 60_000, regions: Object.fromEntries(
    ['ap-southeast-1', 'ap-northeast-1'].map((r) => [r, { requests: 0, success: 0, error4xx: 0, error5xx: 0, latencyAvgMs: 0, latencyP95Ms: 0 }])) }));
  const report = (over: Record<string, unknown> = {}) => ({
    range: '1h', keyId: null, generatedAt: NOW, series: emptySeries(2), endpoints: [], routes: [],
    regions: [
      { region: 'ap-southeast-1', requests: 40, success: 30, error4xx: 6, error5xx: 4, gatewayErrors: 0, upstreamErrors: 4, latencyAvgMs: 500, latencyP95Ms: 2100 },
      { region: 'ap-northeast-1', requests: 10, success: 10, error4xx: 0, error5xx: 0, gatewayErrors: 0, upstreamErrors: 0, latencyAvgMs: 150, latencyP95Ms: 300 },
    ],
    ...over,
  });
  // Trả dữ liệu theo URL: /monitoring/* là số liệu hạ tầng, /api/report là traffic của doanh nghiệp.
  const routed = (monitoring: unknown, tenant: unknown = report()) =>
    vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify(String(url).includes('/api/report') ? tenant : monitoring), { status: 200 }));

  it('gọi đúng đường dẫn, bỏ dấu / thừa và truyền API key vào báo cáo', async () => {
    const fetchFn = routed([]);
    await new HttpProvider('https://backend.example/', fetchFn, 'https://portal.example').getEndpoints('24h', 'aaaaaaaaaaaa');
    expect(fetchFn).toHaveBeenCalledWith('https://portal.example/api/report?range=24h&keyId=aaaaaaaaaaaa', expect.anything());
    const incidents = routed([]);
    await new HttpProvider('https://backend.example/', incidents).getIncidents();
    expect(incidents).toHaveBeenCalledWith('https://backend.example/monitoring/incidents', expect.anything());
  });

  it('báo lỗi khi backend trả mã lỗi hoặc sai định dạng', async () => {
    await expect(new HttpProvider('https://b.example', respond({}, 503)).getSnapshot('1h')).rejects.toThrow('503');
    await expect(new HttpProvider('https://b.example', respond({ nope: true })).getSnapshot('1h')).rejects.toThrow('sai định dạng');
    await expect(new HttpProvider('https://b.example', routed([], { ...report(), regions: [] })).getRoutes('1h')).rejects.toThrow('sai định dạng');
  });

  it('ghép traffic của doanh nghiệp vào số liệu hạ tầng và tách lỗi gateway với lỗi backend', async () => {
    const platform = await new NotConnectedProvider().getSnapshot('1h');
    const merged = await new HttpProvider('https://b.example', routed(platform)).getSnapshot('1h');
    const sg = merged.regions.find((r) => r.region === 'ap-southeast-1')!;
    expect(sg.requests).toEqual({ kind: 'value', value: 40 });
    expect(sg.trafficSharePct).toEqual({ kind: 'value', value: 80 });
    expect(sg.gatewayErrorRatePct).toEqual({ kind: 'value', value: 0 });
    expect(sg.upstreamErrorRatePct).toEqual({ kind: 'value', value: 10 });
    expect(sg.healthCheck).toEqual(platform.regions[0].healthCheck);
    expect(merged.series).toHaveLength(2);
  });

  it('key mới: traffic lấy từ báo cáo doanh nghiệp (0), số liệu hạ tầng toàn hệ thống giữ nguyên ở mục riêng', async () => {
    const base = await new NotConnectedProvider().getSnapshot('1h');
    const v = (n: number) => ({ kind: 'value', value: n }) as const;
    // CloudWatch: /proxy của mọi doanh nghiệp = 200, health check = 10800.
    const platform = { ...base, regions: base.regions.map((r) => ({ ...r, requests: v(200),
      apiGateway: { requests: v(11092), error4xx: v(0), error5xx: v(0), healthCheckRequests: v(10800), proxyRequests: v(200) } })) };
    const empty = { requests: 0, success: 0, error4xx: 0, error5xx: 0, gatewayErrors: 0, upstreamErrors: 0, latencyAvgMs: 0, latencyP95Ms: 0 };
    const tenant = report({ regions: [{ region: 'ap-southeast-1', ...empty }, { region: 'ap-northeast-1', ...empty }] });
    const merged = await new HttpProvider('https://b.example', routed(platform, tenant)).getSnapshot('1h', 'aaaaaaaaaaaa');
    for (const r of merged.regions) {
      expect(r.requests).toEqual(v(0));
      expect(r.errorRatePct.kind).toBe('missing');
      expect(r.apiGateway.healthCheckRequests).toEqual(v(10800));
      expect(r.apiGateway.proxyRequests).toEqual(v(200));
    }
    const bad = { ...platform, regions: platform.regions.map((r) => ({ ...r, apiGateway: { ...r.apiGateway, healthCheckRequests: 5 } })) };
    await expect(new HttpProvider('https://b.example', routed(bad)).getSnapshot('1h')).rejects.toThrow('sai định dạng');
  });

  it('từ chối snapshot hạ tầng thiếu Region hoặc metric trước khi trang truy cập dữ liệu', async () => {
    const snapshot = await new NotConnectedProvider().getSnapshot('1h');
    for (const regions of [[], [snapshot.regions[0]], [snapshot.regions[0], snapshot.regions[0]], [{}, {}]]) {
      await expect(new HttpProvider('https://b.example', routed({ ...snapshot, regions })).getSnapshot('1h')).rejects.toThrow('sai định dạng');
    }
    const malformed = { ...snapshot, regions: snapshot.regions.map((r) => ({ ...r, lambda: null })) };
    await expect(new HttpProvider('https://b.example', routed(malformed)).getSnapshot('1h')).rejects.toThrow('sai định dạng');
    const mock = new MockProvider(0, () => NOW);
    await expect(new HttpProvider('https://b.example', routed(await mock.getSnapshot('1h'))).getSnapshot('1h')).rejects.toThrow('sai định dạng');
  });

  it('nhận endpoint ANY và từ chối phần tử sai cấu trúc trong báo cáo', async () => {
    const endpoint = { method: 'ANY', path: '/todos/1', region: 'ap-southeast-1', requests: 3, successRatePct: 100, errorRatePct: 0, latencyAvgMs: 40, lastUpdated: NOW };
    await expect(new HttpProvider('https://b.example', routed([], report({ endpoints: [endpoint] }))).getEndpoints('1h')).resolves.toEqual([endpoint]);
    await expect(new HttpProvider('https://b.example', routed([], report({ endpoints: [{ ...endpoint, method: 'OPTIONS' }] }))).getEndpoints('1h')).rejects.toThrow('sai định dạng');
    await expect(new HttpProvider('https://b.example', routed([], report({ routes: [{}] }))).getRoutes('1h')).rejects.toThrow('sai định dạng');
    const bad = new HttpProvider('https://b.example', respond([{}]));
    await expect(bad.getIncidents()).rejects.toThrow('sai định dạng');
    await expect(bad.getSources()).rejects.toThrow('sai định dạng');
    const mock = new MockProvider(0, () => NOW);
    await expect(new HttpProvider('https://b.example', respond(await mock.getIncidents())).getIncidents()).rejects.toThrow('sai định dạng');
  });
});

describe('createProvider', () => {
  it('chọn nguồn theo chế độ demo và URL backend', () => {
    expect(createProvider(true, '').id).toBe('mock');
    expect(createProvider(true, 'https://b.example').id).toBe('mock');
    expect(createProvider(false, '').id).toBe('none');
    expect(createProvider(false, 'https://b.example').id).toBe('http');
  });
});
