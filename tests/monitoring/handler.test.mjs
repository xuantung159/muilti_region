import test from 'node:test';
import assert from 'node:assert/strict';
import { handler, handleRequest, createService, loadConfig } from '../../src/monitoring/index.mjs';

test('S3 monitoring can still be explicitly disabled per Region', async () => {
  const config = loadConfig(JSON.stringify({ regions: { 'ap-northeast-1': { s3: null } } }));
  const service = createService({ config, clientFor: () => ({ send: async () => ({}) }) });
  const result = await service.snapshot('1h');
  assert.deepEqual(result.regions[1].s3ReplicationLatencyS, { kind: 'missing', reason: 'not_configured' });
  const s3 = (await service.sources()).find((s) => s.id === 's3-replication');
  assert.match(s3.note, /Tokyo: not_configured/);
});

test('Lambda context is not treated as the monitoring service', async () => {
  const response = await handler({ httpMethod: 'POST', path: '/monitoring/sources' }, { awsRequestId: 'lambda-context' });
  assert.equal(response.statusCode, 405);
});

test('real Lambda-style request receives sources from the service', async () => {
  const response = await handleRequest({ httpMethod: 'GET', path: '/monitoring/sources' }, { sources: async () => [{ id: 'aws' }] });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), [{ id: 'aws' }]);
});

test('snapshot uses Route 53 status from us-east-1 and preserves missing status', async () => {
  const now = Date.UTC(2026, 9, 27, 15, 0);
  const service = createService({ now: () => now, clientFor: (region) => ({ send: async (command) => {
    const queries = command.input.MetricDataQueries;
    if (region === 'us-east-1') return { MetricDataResults: [{ Id: 'h0', Timestamps: [new Date(now - 60000)], Values: [1] }] };
    return { MetricDataResults: queries.map((q) => ({ Id: q.Id, Timestamps: [new Date(now - 180000)], Values: [q.Id === 'a_count' ? 10 : 0] })) };
  } }) });
  const result = await service.snapshot('1h');
  assert.deepEqual(result.regions[0].healthCheck, { kind: 'value', value: 'healthy' });
  assert.deepEqual(result.regions[1].healthCheck, { kind: 'missing', reason: 'unavailable' });
  assert.equal(result.dataMode, 'live');
});

const S3_POINTS = [11, 0, 3];

// Metric S3 chỉ trả dữ liệu khi truy vấn đúng Region đích của từng rule.
const s3Service = ({ now, calls = [], s3Fails = false }) => createService({ now: () => now, clientFor: (region) => ({ send: async (command) => {
  const queries = command.input.MetricDataQueries;
  const results = [];
  for (const q of queries) {
    calls.push({ region, id: q.Id, stat: q.MetricStat.Stat, dimensions: q.MetricStat.Metric.Dimensions });
    if (q.Id === 's_rep') {
      if (s3Fails) throw Object.assign(new Error('denied'), { name: 'AccessDenied' });
      const rule = q.MetricStat.Metric.Dimensions.find((d) => d.Name === 'RuleId')?.Value;
      if ((region === 'ap-northeast-1' && rule === 'mrapi-sg-to-tyo') || (region === 'ap-southeast-1' && rule === 'mrapi-tyo-to-sg')) {
        results.push({ Id: q.Id, Timestamps: S3_POINTS.map((_, i) => new Date(now - (i + 3) * 60000)), Values: S3_POINTS });
      }
    } else if (region !== 'us-east-1') {
      results.push({ Id: q.Id, Timestamps: [new Date(now - 180000)], Values: [q.Id === 'a_count' ? 10 : 0] });
    }
  }
  return { MetricDataResults: results };
} }) });

test('S3 replication metric is queried in the destination Region and reports the maximum', async () => {
  const now = Date.UTC(2026, 10, 1, 6, 0);
  const calls = [];
  const result = await s3Service({ now, calls }).snapshot('1h');
  const s3Calls = calls.filter((c) => c.id === 's_rep');
  assert.deepEqual(s3Calls.map(({ region, id, stat }) => ({ region, id, stat })), [
    { region: 'ap-northeast-1', id: 's_rep', stat: 'Maximum' },
    { region: 'ap-southeast-1', id: 's_rep', stat: 'Maximum' },
  ]);
  assert.deepEqual(s3Calls[1].dimensions, [
    { Name: 'SourceBucket', Value: 'mrapi-exports-tyo' },
    { Name: 'DestinationBucket', Value: 'mrapi-exports-sg' },
    { Name: 'RuleId', Value: 'mrapi-tyo-to-sg' },
  ]);
  assert.deepEqual(result.regions[0].s3ReplicationLatencyS, { kind: 'value', value: 11 });
  assert.deepEqual(result.regions[1].s3ReplicationLatencyS, { kind: 'value', value: 11 });
});

test('S3 metric failure leaves regional data intact', async () => {
  const now = Date.UTC(2026, 10, 1, 6, 0);
  const result = await s3Service({ now, s3Fails: true }).snapshot('1h');
  assert.deepEqual(result.regions[0].s3ReplicationLatencyS, { kind: 'missing', reason: 'unavailable' });
  assert.deepEqual(result.regions[0].requests, { kind: 'value', value: 10 });
  assert.deepEqual(result.regions[1].s3ReplicationLatencyS, { kind: 'missing', reason: 'unavailable' });
});

test('sources reports S3 data found in the destination Region', async () => {
  const now = Date.UTC(2026, 10, 1, 6, 0);
  const sources = await handleRequest({ httpMethod: 'GET', path: '/monitoring/sources' }, s3Service({ now }));
  const s3 = JSON.parse(sources.body).find((s) => s.id === 's3-replication');
  assert.match(s3.note, /Singapore: có dữ liệu trong 1 giờ qua/);
  assert.match(s3.note, /Tokyo: có dữ liệu trong 1 giờ qua/);
  assert.equal(s3.regions, 'Singapore, Tokyo');
  assert.doesNotMatch(s3.note, /not_configured|chưa bật/);
});
