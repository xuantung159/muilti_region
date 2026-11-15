import { describe, expect, it } from 'vitest';
import { buildSnapshot } from '../data/mock/generator';
import { currentReplicationHealth, replicationFreshness, deriveEndpointHealth, deriveRegionHealth, deriveReplicationHealth, sumMetrics, weightedAverage } from './status';
import { type EndpointStat, missing, type RegionSnapshot, value } from './types';

const base: RegionSnapshot = buildSnapshot('1h', Date.UTC(2026, 9, 13, 5)).regions[0];

describe('deriveRegionHealth', () => {
  it('không kết luận Healthy khi thiếu health check', () => {
    expect(deriveRegionHealth({ ...base, healthCheck: missing('not_connected') })).toBe('unknown');
  });

  it('Region không có traffic nhưng health check Healthy thì là Healthy, không phải Unknown', () => {
    const idle = { ...base, healthCheck: value<'healthy' | 'unhealthy'>('healthy'), requests: value(0),
      errorRatePct: missing('unavailable'), serverErrorRatePct: missing('unavailable'), latencyP95Ms: missing('unavailable') };
    expect(deriveRegionHealth(idle)).toBe('healthy');
  });

  it('health check unhealthy là Down dù error rate thấp', () => {
    expect(deriveRegionHealth({ ...base, healthCheck: value('unhealthy'), errorRatePct: value(0) })).toBe('down');
  });

  it('lỗi 4xx của client (key sai) không làm Region Down', () => {
    // Tình huống thật: 17 request, 5 lỗi 401 + 1 lỗi 502 → error rate 35%, nhưng Route 53 vẫn Healthy.
    const r = { ...base, healthCheck: value<'healthy' | 'unhealthy'>('healthy'), requests: value(17),
      errorRatePct: value(35.29), serverErrorRatePct: value(5.88), latencyP95Ms: value(1703) };
    expect(deriveRegionHealth(r)).toBe('healthy'); // dưới 20 request: mẫu quá nhỏ để kết luận
    const many = { ...r, requests: value(500), errorRatePct: value(40), serverErrorRatePct: value(0.2), latencyP95Ms: value(300) };
    expect(deriveRegionHealth(many)).toBe('healthy'); // 40% lỗi nhưng gần như toàn 4xx
  });

  it('chỉ lỗi gateway hạ bậc Region; backend chậm hoặc 502 của backend thì không', () => {
    const healthy = { ...base, healthCheck: value<'healthy' | 'unhealthy'>('healthy'), requests: value(500), latencyP95Ms: value(120) };
    expect(deriveRegionHealth({ ...healthy, gatewayErrorRatePct: value(0.5) })).toBe('healthy');
    expect(deriveRegionHealth({ ...healthy, gatewayErrorRatePct: value(2) })).toBe('degraded');
    // Health check Healthy thì lỗi gateway cao (vd. sự cố vừa phục hồi, còn trong khoảng 1 giờ) chỉ là Degraded.
    expect(deriveRegionHealth({ ...healthy, gatewayErrorRatePct: value(10) })).toBe('degraded');
    expect(deriveRegionHealth({ ...healthy, gatewayErrorRatePct: value(60) })).toBe('degraded');
    // Tình huống thật 10/11/2026: backend jsonplaceholder chậm (p95 ~2 s) và tunnel tắt (502) nhưng gateway không lỗi.
    expect(deriveRegionHealth({ ...healthy, gatewayErrorRatePct: value(0), serverErrorRatePct: value(5.3), upstreamErrorRatePct: value(5.3), latencyP95Ms: value(2225) })).toBe('healthy');
  });

  it('chưa tách lỗi gateway thì dùng tỷ lệ lỗi của Lambda proxy, không dùng 5xx tổng', () => {
    const old = { ...base, healthCheck: value<'healthy' | 'unhealthy'>('healthy'), requests: value(500), serverErrorRatePct: value(12),
      lambda: { invocations: value(1000), errors: value(0), durationAvgMs: value(30) } };
    delete (old as Partial<RegionSnapshot>).gatewayErrorRatePct;
    expect(deriveRegionHealth(old)).toBe('healthy');
    expect(deriveRegionHealth({ ...old, lambda: { ...old.lambda, errors: value(150) } })).toBe('degraded');
    expect(deriveRegionHealth({ ...old, lambda: { ...old.lambda, invocations: value(10), errors: value(5) } })).toBe('healthy'); // mẫu nhỏ
  });
});

describe('các hàm suy diễn khác', () => {
  it('replication thiếu số liệu là Unknown', () => {
    expect(deriveReplicationHealth(missing('not_configured'))).toBe('unknown');
    expect(deriveReplicationHealth(value(900))).toBe('healthy');
    expect(deriveReplicationHealth(value(3000))).toBe('degraded');
    expect(deriveReplicationHealth(value(20_000))).toBe('down');
  });

  it('endpoint không có request là Unknown, không phải Healthy', () => {
    const endpoint: EndpointStat = { method: 'GET', path: '/x', region: 'ap-southeast-1', requests: 0, successRatePct: 100, errorRatePct: 0, latencyAvgMs: 0, lastUpdated: 0 };
    expect(deriveEndpointHealth(endpoint)).toBe('unknown');
    expect(deriveEndpointHealth({ ...endpoint, requests: 100, errorRatePct: 1.5 })).toBe('degraded');
    expect(deriveEndpointHealth({ ...endpoint, requests: 100, errorRatePct: 6 })).toBe('down');
    expect(deriveEndpointHealth({ ...endpoint, requests: 100, errorRatePct: 30, serverErrorRatePct: 0 })).toBe('healthy');
    expect(deriveEndpointHealth({ ...endpoint, requests: 17, errorRatePct: 35, serverErrorRatePct: 5.9 })).toBe('degraded');
    expect(deriveEndpointHealth({ ...endpoint, requests: 17, errorRatePct: 29, serverErrorRatePct: 0 })).toBe('healthy');
  });

  it('tổng và trung bình giữ trạng thái thiếu khi không có giá trị nào', () => {
    expect(sumMetrics([missing('not_connected'), missing('not_connected')])).toEqual(missing('not_connected'));
    expect(sumMetrics([value(3), missing('unavailable'), value(4)])).toEqual(value(7));
    expect(weightedAverage([{ metric: missing('not_connected'), weight: missing('not_connected') }])).toEqual(missing('not_connected'));
    expect(
      weightedAverage([
        { metric: value(10), weight: value(1) },
        { metric: value(20), weight: value(3) },
      ]),
    ).toEqual(value(17.5));
  });
});

it('không gắn Healthy cho metric replication cũ hoặc thiếu thời điểm đo', () => {
  const now = Date.UTC(2026, 10, 13, 3);
  expect(currentReplicationHealth(value(900), now - 60_000, now)).toBe('healthy');
  expect(currentReplicationHealth(value(900), now - 3_600_001, now)).toBe('unknown');
  expect(currentReplicationHealth(value(900), undefined, now)).toBe('unknown');
  expect(currentReplicationHealth(missing('unavailable'), now, now)).toBe('unknown');
  expect(replicationFreshness(value(900), now + 1, now)).toBe('stale');
});
