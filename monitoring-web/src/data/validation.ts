import { REGIONS } from '../domain/types';

type RecordValue = Record<string, unknown>;
const record = (v: unknown): v is RecordValue => !!v && typeof v === 'object' && !Array.isArray(v);
const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const text = (v: unknown) => typeof v === 'string';
const nullableNumber = (v: unknown) => v === null || number(v);
const oneOf = (v: unknown, values: readonly unknown[]) => values.includes(v);
const region = (v: unknown) => REGIONS.some((r) => r.code === v);
const fields = (v: unknown, keys: string[], check: (x: unknown) => boolean) => record(v) && keys.every((k) => check(v[k]));
const list = (v: unknown, check: (x: unknown) => boolean) => Array.isArray(v) && v.every(check);

function metric(v: unknown, check = number): boolean {
  return record(v) && (v.kind === 'value' ? check(v.value) : v.kind === 'missing' && oneOf(v.reason, ['not_connected', 'unavailable', 'not_configured']));
}

function regionSnapshot(v: unknown): boolean {
  return record(v) && region(v.region)
    && metric(v.healthCheck, (x) => oneOf(x, ['healthy', 'unhealthy']))
    && fields(v, ['trafficSharePct', 'requests', 'successRatePct', 'errorRatePct', 'latencyAvgMs', 'latencyP95Ms', 'dynamodbReplicationLatencyMs', 's3ReplicationLatencyS'], metric)
    && fields(v.lambda, ['invocations', 'errors', 'durationAvgMs'], metric)
    && fields(v.apiGateway, ['requests', 'error4xx', 'error5xx'], metric);
}

export function validSnapshot(v: unknown): boolean {
  if (!record(v)) return false;
  const regions = v.regions;
  return v.dataMode === 'live' && nullableNumber(v.generatedAt)
    && oneOf(v.range, ['1h', '6h', '24h', '7d']) && metric(v.routingPolicy, text)
    && Array.isArray(regions) && regions.length === REGIONS.length
    && regions.every(regionSnapshot)
    && REGIONS.every((r) => regions.some((x) => x.region === r.code))
    && list(v.series, (p) => record(p) && number(p.t) && record(p.regions)
      && REGIONS.every((r) => record(p.regions) && fields(p.regions[r.code], ['requests', 'success', 'error4xx', 'error5xx', 'latencyAvgMs', 'latencyP95Ms'], number)));
}

export const validEndpoints = (v: unknown): boolean => list(v, (e) => record(e)
  && oneOf(e.method, ['GET', 'POST', 'PUT', 'DELETE']) && text(e.path) && region(e.region)
  && fields(e, ['requests', 'successRatePct', 'errorRatePct', 'latencyAvgMs', 'lastUpdated'], number));

export const validIncidents = (v: unknown): boolean => list(v, (e) => record(e)
  && fields(e, ['id', 'title', 'description'], text)
  && oneOf(e.kind, ['incident', 'traffic_shift', 'failover_test']) && oneOf(e.origin, ['aws', 'manual_test'])
  && (region(e.region) || e.region === 'global') && number(e.startedAt)
  && nullableNumber(e.endedAt) && nullableNumber(e.recoverySeconds)
  && list(e.evidence, (x) => fields(x, ['label', 'detail'], text)));

export const validSources = (v: unknown): boolean => list(v, (s) => record(s)
  && fields(s, ['id', 'service', 'regions', 'note', 'guide'], text)
  && oneOf(s.status, ['not_connected', 'connected', 'error']) && nullableNumber(s.lastSync) && list(s.metrics, text));
