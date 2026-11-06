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

  it('gọi đúng đường dẫn và bỏ dấu / thừa ở URL gốc', async () => {
    const fetchFn = respond([]);
    await new HttpProvider('https://backend.example/', fetchFn).getEndpoints('24h');
    expect(fetchFn).toHaveBeenCalledWith('https://backend.example/monitoring/endpoints?range=24h', expect.anything());
  });

  it('báo lỗi khi backend trả mã lỗi hoặc sai định dạng', async () => {
    await expect(new HttpProvider('https://b.example', respond({}, 503)).getSnapshot('1h')).rejects.toThrow('503');
    await expect(new HttpProvider('https://b.example', respond({ nope: true })).getSnapshot('1h')).rejects.toThrow('sai định dạng');
  });

  it('từ chối snapshot thiếu Region hoặc metric trước khi trang truy cập dữ liệu', async () => {
    const snapshot = await new NotConnectedProvider().getSnapshot('1h');
    await expect(new HttpProvider('https://b.example', respond(snapshot)).getSnapshot('1h')).resolves.toEqual(snapshot);
    for (const regions of [[], [snapshot.regions[0]], [snapshot.regions[0], snapshot.regions[0]], [{}, {}]]) {
      await expect(new HttpProvider('https://b.example', respond({ ...snapshot, regions })).getSnapshot('1h')).rejects.toThrow('sai định dạng');
    }
    const malformed = { ...snapshot, regions: snapshot.regions.map((r) => ({ ...r, lambda: null })) };
    await expect(new HttpProvider('https://b.example', respond(malformed)).getSnapshot('1h')).rejects.toThrow('sai định dạng');
  });

  it('từ chối phần tử sai cấu trúc và dữ liệu mô phỏng trong nguồn live', async () => {
    const provider = new HttpProvider('https://b.example', respond([{}]));
    await expect(provider.getEndpoints('1h')).rejects.toThrow('sai định dạng');
    await expect(provider.getIncidents()).rejects.toThrow('sai định dạng');
    await expect(provider.getSources()).rejects.toThrow('sai định dạng');
    const mock = new MockProvider(0, () => NOW);
    const snapshot = { ...await mock.getSnapshot('1h'), dataMode: 'live' };
    await expect(new HttpProvider('https://b.example', respond(snapshot)).getSnapshot('1h')).resolves.toEqual(snapshot);
    await expect(new HttpProvider('https://b.example', respond({ ...snapshot, series: [{ t: NOW, regions: {} }] })).getSnapshot('1h')).rejects.toThrow('sai định dạng');
    await expect(new HttpProvider('https://b.example', respond(await mock.getSnapshot('1h'))).getSnapshot('1h')).rejects.toThrow('sai định dạng');
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
