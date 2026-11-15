import { ERROR_CLASSES, REGIONS } from '../domain/types';

type RecordValue = Record<string, unknown>;
const record = (v: unknown): v is RecordValue => !!v && typeof v === 'object' && !Array.isArray(v);
const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const text = (v: unknown) => typeof v === 'string';
const nullableNumber = (v: unknown) => v === null || number(v);
const oneOf = (v: unknown, values: readonly unknown[]) => values.includes(v);
const region = (v: unknown) => REGIONS.some((r) => r.code === v);
const fields = (v: unknown, keys: string[], check: (x: unknown) => boolean) => record(v) && keys.every((k) => check(v[k]));
const list = (v: unknown, check: (x: unknown) => boolean) => Array.isArray(v) && v.every(check);
const count = (v: unknown) => number(v) && (v as number) >= 0;
// Trường tùy chọn: thiếu thì hợp lệ (backend cũ), có thì phải đúng shape.
const optional = (v: unknown, check: (x: unknown) => boolean) => v === undefined || check(v);

// ----- schemaVersion 2 (docs/performance/LATENCY_ANALYSIS.md §5.2) -----
export const errorClassCounts = (v: unknown): boolean => fields(v, [...ERROR_CLASSES], count);
const errorClass = (v: unknown) => oneOf(v, ERROR_CLASSES);

export const latencyStats = (v: unknown): boolean => record(v) && count(v.samples)
  && fields(v, ['avgMs', 'p50Ms', 'p90Ms', 'p95Ms', 'p99Ms', 'maxMs'], nullableNumber);

export const latencyBreakdown = (v: unknown): boolean => record(v)
  && fields(v, ['samples', 'upstreamSamples', 'connectSamples', 'ttfbSamples', 'coldStarts'], count)
  && fields(v, ['gatewayAvgMs', 'gatewayP95Ms', 'upstreamAvgMs', 'upstreamP95Ms', 'upstreamConnectAvgMs', 'upstreamConnectP95Ms',
    'upstreamTtfbAvgMs', 'upstreamTtfbP95Ms', 'reusedConnectionPct'], nullableNumber);

export const trafficStats = (v: unknown): boolean => record(v)
  && fields(v, ['requests', 'success', 'error4xx', 'error5xx', 'timeout'], count)
  && errorClassCounts(v.errorsByClass)
  && fields(v, ['successRatePct', 'errorRatePct', 'error4xxRatePct', 'error5xxRatePct', 'gatewayErrorRatePct', 'upstreamErrorRatePct', 'timeoutRatePct'], nullableNumber)
  && latencyStats(v.latency) && latencyStats(v.latencySuccess) && latencyBreakdown(v.breakdown);

const bucketLatency = (v: unknown) => v === null || fields(v, ['avgMs', 'p50Ms', 'p95Ms', 'p99Ms'], number);

// Ô thời gian: trường cũ bắt buộc; trường mới tùy chọn.
const bucket = (v: unknown) => fields(v, ['requests', 'success', 'error4xx', 'error5xx', 'latencyAvgMs', 'latencyP95Ms'], number)
  && record(v) && optional(v.hasData, (x) => typeof x === 'boolean')
  && ['timeout', 'gatewayErrors', 'upstreamErrors'].every((k) => optional(v[k], count))
  && optional(v.errorsByClass, errorClassCounts) && optional(v.latency, bucketLatency);

const seriesPoint = (p: unknown) => record(p) && number(p.t) && record(p.regions)
  && optional(p.partial, (x) => typeof x === 'boolean')
  && REGIONS.every((r) => bucket((p.regions as RecordValue)[r.code]));

const keyErrorStat = (v: unknown) => record(v) && text(v.keyId)
  && (v.name === null || text(v.name)) && (v.status === null || oneOf(v.status, ['active', 'revoked']))
  && fields(v, ['requests', 'error4xx', 'error5xx', 'timeout'], count) && errorClassCounts(v.errorsByClass) && nullableNumber(v.errorRatePct);

const errorTypeStat = (v: unknown) => record(v) && errorClass(v.errorClass)
  && (v.errorType === null || text(v.errorType)) && region(v.region)
  && fields(v, ['status', 'count', 'lastSeen'], number);

function metric(v: unknown, check = number): boolean {
  return record(v) && (v.kind === 'value' ? check(v.value) : v.kind === 'missing' && oneOf(v.reason, ['not_connected', 'unavailable', 'not_configured']));
}

function regionSnapshot(v: unknown): boolean {
  return record(v) && region(v.region)
    && metric(v.healthCheck, (x) => oneOf(x, ['healthy', 'unhealthy']))
    && ['dynamodbReplicationObservedAt', 's3ReplicationObservedAt'].every((k) => optional(v[k], nullableNumber))
    && fields(v, ['trafficSharePct', 'requests', 'successRatePct', 'errorRatePct', 'latencyAvgMs', 'latencyP95Ms', 'dynamodbReplicationLatencyMs', 's3ReplicationLatencyS'], metric)
    && (v.serverErrorRatePct === undefined || metric(v.serverErrorRatePct))
    && fields(v.lambda, ['invocations', 'errors', 'durationAvgMs'], metric)
    && fields(v.apiGateway, ['requests', 'error4xx', 'error5xx'], metric)
    && record(v.apiGateway) && ['healthCheckRequests', 'proxyRequests'].every((k) => (v.apiGateway as RecordValue)[k] === undefined || metric((v.apiGateway as RecordValue)[k]));
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
  && oneOf(e.method, ['GET', 'POST', 'PUT', 'DELETE', 'ANY']) && text(e.path) && region(e.region)
  && fields(e, ['requests', 'successRatePct', 'errorRatePct', 'latencyAvgMs', 'lastUpdated'], number)
  && (e.serverErrorRatePct === undefined || number(e.serverErrorRatePct))
  && ['error4xxRatePct', 'timeoutRatePct', 'latencyP50Ms', 'latencyP99Ms'].every((k) => optional(e[k], number))
  && optional(e.errorsByClass, errorClassCounts));

const reportRegion = (v: unknown) => record(v) && region(v.region)
  && fields(v, ['requests', 'success', 'error4xx', 'error5xx', 'gatewayErrors', 'upstreamErrors', 'latencyAvgMs', 'latencyP95Ms'], number)
  && optional(v.stats, trafficStats);

// GET /api/report: traffic của doanh nghiệp (src/dashboard/report.mjs).
export function validReport(v: unknown): boolean {
  if (!record(v)) return false;
  return oneOf(v.range, ['1h', '6h', '24h', '7d']) && number(v.generatedAt) && (v.keyId === null || text(v.keyId))
    && list(v.regions, reportRegion) && REGIONS.every((r) => (v.regions as RecordValue[]).some((x) => x.region === r.code))
    && list(v.series, seriesPoint)
    && validEndpoints(v.endpoints) && validRoutes(v.routes)
    && optional(v.schemaVersion, number)
    && optional(v.filters, (f) => record(f) && oneOf(f.range, ['1h', '6h', '24h', '7d']) && (f.keyId === null || text(f.keyId)) && (f.region === 'all' || region(f.region)))
    && optional(v.window, (w) => fields(w, ['startMs', 'endMs', 'bucketMs', 'buckets'], number))
    && optional(v.totals, trafficStats)
    && optional(v.errorsByKey, (x) => list(x, keyErrorStat))
    && optional(v.errorTypes, (x) => list(x, errorTypeStat));
}

export const validRoutes = (v: unknown): boolean => list(v, (e) => record(e)
  && text(e.country) && /^[A-Z]{2}$/.test(e.country as string) && region(e.servedRegion)
  && fields(e, ['requests', 'lastSeen'], number));

export const validIncidents = (v: unknown): boolean => list(v, (e) => record(e)
  && fields(e, ['id', 'title', 'description'], text)
  && oneOf(e.kind, ['incident', 'traffic_shift', 'failover_test']) && oneOf(e.origin, ['aws', 'manual_test'])
  && (region(e.region) || e.region === 'global') && number(e.startedAt)
  && nullableNumber(e.endedAt) && nullableNumber(e.recoverySeconds)
  && list(e.evidence, (x) => fields(x, ['label', 'detail'], text))
  && (e.xray === undefined || xrayCorrelation(e.xray)));

const AWS_CONSOLE = /^https:\/\/[a-z0-9-]+\.console\.aws\.amazon\.com\//;
function xrayCorrelation(v: unknown): boolean {
  if (!record(v)) return false;
  if (v.status === 'not_connected') return true;
  if (v.status === 'error') return v.detail === undefined || text(v.detail);
  return v.status === 'connected'
    && fields(v, ['start', 'end', 'traces', 'faults', 'errors', 'throttles'], number)
    && nullableNumber(v.firstFaultAt) && nullableNumber(v.lastFaultAt) && typeof v.truncated === 'boolean'
    && list(v.sampleTraceIds, (x) => text(x) && /^1-[0-9a-f]{8}-[0-9a-f]{24}$/.test(x as string))
    && text(v.consoleUrl) && AWS_CONSOLE.test(v.consoleUrl as string);
}

export const validSources = (v: unknown): boolean => list(v, (s) => record(s)
  && fields(s, ['id', 'service', 'regions', 'note', 'guide'], text)
  && oneOf(s.status, ['not_connected', 'connected', 'error']) && nullableNumber(s.lastSync) && list(s.metrics, text));
