import { describe, expect, it, vi } from 'vitest';
import { buildReportV2, toV1 } from '../test/fixtures/report';
import { ERROR_CLASSES } from '../domain/types';
import { HttpProvider, MockProvider, NotConnectedProvider } from './providers';
import { validReport } from './validation';

const NOW = Date.UTC(2026, 10, 13, 5, 7, 30);

describe('validReport với hợp đồng schemaVersion 2', () => {
  it('nhận báo cáo mới, và báo cáo cũ (không có trường mới) vẫn hợp lệ', () => {
    const v2 = buildReportV2('6h', NOW);
    expect(validReport(JSON.parse(JSON.stringify(v2)))).toBe(true);
    expect(validReport(JSON.parse(JSON.stringify(toV1(v2))))).toBe(true);
  });

  it('nhận latency null ở ô rỗng; từ chối trường mới sai shape', () => {
    const v2 = buildReportV2('1h', NOW);
    const sg = v2.series[0].regions['ap-southeast-1'];
    v2.series[0].regions['ap-southeast-1'] = { ...sg, requests: 0, success: 0, error4xx: 0, error5xx: 0, hasData: false, latency: null };
    expect(validReport(v2)).toBe(true);
    expect(validReport({ ...v2, totals: { ...v2.totals, latency: { samples: 1 } } })).toBe(false);
    expect(validReport({ ...v2, errorTypes: [{ errorClass: 'nope', errorType: null, status: 500, region: 'ap-southeast-1', count: 1, lastSeen: 1 }] })).toBe(false);
    expect(validReport({ ...v2, filters: { range: '6h', keyId: null, region: 'us-east-1' } })).toBe(false);
    expect(validReport({ ...v2, series: [{ ...v2.series[0], partial: 'yes' }] })).toBe(false);
  });
});

describe('dữ liệu mẫu đúng hợp đồng', () => {
  it('bất biến 4xx = client_4xx + upstream_4xx, 5xx = gateway + upstream_5xx + timeout + connection_error', async () => {
    const snapshot = await new MockProvider(0, () => NOW).getSnapshot('24h');
    for (const p of snapshot.series)
      for (const b of Object.values(p.regions)) {
        const c = b.errorsByClass!;
        expect(c.client_4xx + c.upstream_4xx).toBe(b.error4xx);
        expect(c.gateway + c.upstream_5xx + c.timeout + c.connection_error).toBe(b.error5xx);
        expect(Object.keys(c).sort()).toEqual([...ERROR_CLASSES].sort());
      }
    const t = snapshot.report!.totals!;
    expect(t.errorsByClass.timeout).toBe(t.timeout);
    expect(snapshot.dataMode).toBe('mock'); // dữ liệu mẫu vẫn gắn nhãn mock
  });

  it('bộ lọc region chỉ đổi phần tổng hợp, không đổi regions[] và series', async () => {
    const mock = new MockProvider(0, () => NOW);
    const all = await mock.getSnapshot('6h');
    const tyo = await mock.getSnapshot('6h', 'all', 'ap-northeast-1');
    expect(tyo.regions).toEqual(all.regions);
    expect(tyo.series).toEqual(all.series);
    expect(tyo.report!.filters!.region).toBe('ap-northeast-1');
    expect(tyo.report!.totals!.requests).toBe(tyo.regions[1].traffic!.requests);
    expect(tyo.report!.errorTypes!.every((e) => e.region === 'ap-northeast-1')).toBe(true);
  });
});

describe('HttpProvider với bộ lọc region', () => {
  const routed = (report: unknown, platform: unknown) =>
    vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify(String(url).includes('/api/report') ? report : platform), { status: 200 }));

  it('gửi region khi khác all, không gửi khi all (giữ URL cũ), và tách cache theo region', async () => {
    const platform = await new NotConnectedProvider().getSnapshot('6h');
    const fetchFn = routed(buildReportV2('6h', NOW), platform);
    const provider = new HttpProvider('https://b.example', fetchFn, 'https://portal.example');
    await provider.getSnapshot('6h', 'all', 'ap-northeast-1');
    await provider.getSnapshot('6h', 'all', 'all');
    const urls = fetchFn.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/api/report'));
    expect(urls).toEqual(['https://portal.example/api/report?range=6h&keyId=all&region=ap-northeast-1', 'https://portal.example/api/report?range=6h&keyId=all']);
  });

  it('mergeReport mang trường mới sang snapshot; null → missing, không thành 0', async () => {
    const platform = await new NotConnectedProvider().getSnapshot('6h');
    const report = buildReportV2('6h', NOW);
    report.regions[1].stats = { ...report.regions[1].stats!, latency: { ...report.regions[1].stats!.latency, p99Ms: null } };
    const merged = await new HttpProvider('https://b.example', routed(report, platform)).getSnapshot('6h');
    const [sg, tyo] = merged.regions;
    expect(merged.report?.totals?.requests).toBe(report.totals!.requests);
    expect(merged.report?.errorsByKey).toEqual(report.errorsByKey);
    expect(merged.report?.errorTypes).toEqual(report.errorTypes);
    expect(sg.timeouts).toEqual({ kind: 'value', value: report.regions[0].stats!.timeout });
    expect(sg.latencyP99Ms).toEqual({ kind: 'value', value: report.regions[0].stats!.latency.p99Ms });
    expect(sg.latencyBreakdown).toEqual(report.regions[0].stats!.breakdown);
    expect(tyo.latencyP99Ms).toEqual({ kind: 'missing', reason: 'unavailable' });
    expect(merged.series[0].regions['ap-southeast-1'].latency).toBeDefined();
  });

  it('backend cũ: không có trường mới nào trên snapshot (giao diện hiện N/A)', async () => {
    const platform = await new NotConnectedProvider().getSnapshot('6h');
    const merged = await new HttpProvider('https://b.example', routed(toV1(buildReportV2('6h', NOW)), platform)).getSnapshot('6h');
    expect(merged.report).toBeUndefined();
    expect(merged.regions[0].latencyP99Ms).toBeUndefined();
    expect(merged.regions[0].timeouts).toBeUndefined();
  });
});
