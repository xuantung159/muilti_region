import { describe, expect, it } from 'vitest';
import { buildSnapshot } from '../test/fixtures/generator';
import { deriveEndpointHealth, deriveRegionHealth, deriveReplicationHealth, sumMetrics, weightedAverage } from './status';
import { type EndpointStat, missing, type RegionSnapshot, value } from './types';

const base: RegionSnapshot = buildSnapshot('1h', Date.UTC(2026, 9, 13, 5)).regions[0];

describe('deriveRegionHealth', () => {
  it('không kết luận Healthy khi thiếu health check', () => {
    expect(deriveRegionHealth({ ...base, healthCheck: missing('not_connected') })).toBe('unknown');
  });

  it('không kết luận Healthy khi có health check nhưng thiếu error rate', () => {
    expect(deriveRegionHealth({ ...base, healthCheck: value('healthy'), errorRatePct: missing('unavailable') })).toBe('unknown');
  });

  it('health check unhealthy là Down dù error rate thấp', () => {
    expect(deriveRegionHealth({ ...base, healthCheck: value('unhealthy'), errorRatePct: value(0) })).toBe('down');
  });

  it('phân loại theo ngưỡng error rate và p95', () => {
    const healthy = { ...base, healthCheck: value<'healthy' | 'unhealthy'>('healthy'), latencyP95Ms: value(120) };
    expect(deriveRegionHealth({ ...healthy, errorRatePct: value(0.5) })).toBe('healthy');
    expect(deriveRegionHealth({ ...healthy, errorRatePct: value(2) })).toBe('degraded');
    expect(deriveRegionHealth({ ...healthy, errorRatePct: value(10) })).toBe('down');
    expect(deriveRegionHealth({ ...healthy, errorRatePct: value(0.5), latencyP95Ms: value(1500) })).toBe('degraded');
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
    expect(deriveEndpointHealth({ ...endpoint, requests: 10, errorRatePct: 1.5 })).toBe('degraded');
    expect(deriveEndpointHealth({ ...endpoint, requests: 10, errorRatePct: 6 })).toBe('down');
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
