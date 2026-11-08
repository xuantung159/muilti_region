import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExportInput, clientTokenFor, handler, loadConfig, runExport } from '../../src/exporter/index.mjs';

const TABLE_ARN = 'arn:aws:dynamodb:ap-southeast-1:138150704839:table/mrapi-telemetry';
const ENV = { TABLE_ARN, EXPORT_BUCKET: 'mrapi-exports-sg', EXPORT_PREFIX: 'exports/telemetry/' };
const NOON = Date.UTC(2026, 10, 1, 12, 0);

const mockClient = (reply = {}) => {
  const calls = [];
  return {
    calls,
    send: async (command) => {
      calls.push(command);
      if (reply instanceof Error) throw reply;
      return { ExportDescription: { ExportArn: `${TABLE_ARN}/export/1`, ExportStatus: 'IN_PROGRESS' }, ...reply };
    },
  };
};

test('config requires every environment variable and names what is missing', () => {
  assert.throws(() => loadConfig({ TABLE_ARN }), /EXPORT_BUCKET, EXPORT_PREFIX/);
});

test('prefix matches earlier exports: no leading or trailing slash', () => {
  assert.equal(loadConfig(ENV).prefix, 'exports/telemetry');
  assert.equal(loadConfig({ ...ENV, EXPORT_PREFIX: '/exports/telemetry' }).prefix, 'exports/telemetry');
});

test('export input has the format of the earlier export', () => {
  assert.deepEqual(buildExportInput(loadConfig(ENV), NOON), {
    TableArn: TABLE_ARN,
    S3Bucket: 'mrapi-exports-sg',
    S3Prefix: 'exports/telemetry',
    ExportFormat: 'DYNAMODB_JSON',
    ExportType: 'FULL_EXPORT',
    ClientToken: 'mrapi-telemetry-2026-11-01',
  });
});

test('client token is stable within a UTC day and changes on the next', () => {
  assert.equal(clientTokenFor(Date.UTC(2026, 10, 1, 0, 0)), clientTokenFor(Date.UTC(2026, 10, 1, 23, 59, 59)));
  assert.notEqual(clientTokenFor(Date.UTC(2026, 10, 1, 23, 59, 59)), clientTokenFor(Date.UTC(2026, 10, 2, 0, 0)));
});

test('retry on the same day sends the same token', async () => {
  const client = mockClient();
  await runExport({ client, config: loadConfig(ENV), now: NOON, log: () => {} });
  await runExport({ client, config: loadConfig(ENV), now: NOON + 60_000, log: () => {} });
  assert.equal(client.calls.length, 2);
  assert.equal(client.calls[0].input.ClientToken, client.calls[1].input.ClientToken);
});

test('result and log carry the export identity', async () => {
  const lines = [];
  const result = await runExport({ client: mockClient(), config: loadConfig(ENV), now: NOON, log: (line) => lines.push(line) });
  assert.deepEqual(result, { exportArn: `${TABLE_ARN}/export/1`, status: 'IN_PROGRESS', clientToken: 'mrapi-telemetry-2026-11-01' });
  assert.deepEqual(JSON.parse(lines[0]), { message: 'EXPORT_REQUESTED', ...result });
});

test('AWS errors propagate so Lambda records Errors for the alarm', async () => {
  const error = Object.assign(new Error('pitr off'), { name: 'PointInTimeRecoveryUnavailableException' });
  await assert.rejects(runExport({ client: mockClient(error), config: loadConfig(ENV), now: NOON, log: () => {} }), error);
});

test('handler fails before calling AWS when configuration is missing', async () => {
  const saved = process.env.TABLE_ARN;
  delete process.env.TABLE_ARN;
  try { await assert.rejects(handler(), /TABLE_ARN/); }
  finally { if (saved !== undefined) process.env.TABLE_ARN = saved; }
});
