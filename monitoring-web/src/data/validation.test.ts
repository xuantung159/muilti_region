import { describe, expect, it } from 'vitest';
import { validIncidents } from './validation';

const base = {
  id: 'ap-southeast-1:route53:1', kind: 'traffic_shift', origin: 'aws', region: 'ap-southeast-1',
  title: 't', description: 'd', startedAt: 1, endedAt: 181_000, recoverySeconds: 180, evidence: [],
};
const xray = {
  status: 'connected', start: 0, end: 300_000, traces: 4, faults: 2, errors: 1, throttles: 0,
  firstFaultAt: 5_000, lastFaultAt: 40_000, truncated: false,
  sampleTraceIds: ['1-6aef672d-697ee1d6655ce4f4437408f0'],
  consoleUrl: 'https://ap-southeast-1.console.aws.amazon.com/cloudwatch/home?region=ap-southeast-1#xray:traces/query',
};

describe('validIncidents', () => {
  it('nhận sự kiện có và không có đối chiếu X-Ray', () => {
    expect(validIncidents([base])).toBe(true);
    expect(validIncidents([{ ...base, xray }])).toBe(true);
    expect(validIncidents([{ ...base, xray: { status: 'not_connected' } }])).toBe(true);
    expect(validIncidents([{ ...base, xray: { status: 'error', detail: 'AccessDeniedException' } }])).toBe(true);
  });
  it('từ chối link không phải AWS Console và trace id sai dạng', () => {
    expect(validIncidents([{ ...base, xray: { ...xray, consoleUrl: 'https://evil.example/x' } }])).toBe(false);
    expect(validIncidents([{ ...base, xray: { ...xray, sampleTraceIds: ['javascript:alert(1)'] } }])).toBe(false);
  });
});
