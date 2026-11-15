import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const { demoGeo, COUNTRIES, HOSTED_ZONE_ID, RECORD_NAME, resetEndpointCache } = await import('../../src/dashboard/demo-geo.mjs');
const { probe } = await import('../../src/probe/index.mjs');

const session = { tenantId: 'tenant-a', expiresAt: Date.now() / 1000 + 60 };
const post = (country) => ({ httpMethod: 'POST', body: JSON.stringify({ country }) });
const body = (res) => JSON.parse(res.body);

const ENDPOINT_IPS = {
  'd-zd1hv50jn0.execute-api.ap-southeast-1.amazonaws.com': ['18.139.143.59', '54.251.131.234'],
  'd-csqvriesoh.execute-api.ap-northeast-1.amazonaws.com': ['52.199.84.170'],
};

function fakes({ answer = ['18.139.143.59'], served = 'ap-southeast-1', ptr = {}, requestError, probeBody } = {}) {
  const calls = { route53: [], request: [], fetch: [] };
  return {
    calls,
    deps: {
      region: 'ap-southeast-1',
      probeUrl: probeBody ? 'https://probe.example/' : '',
      route53: { send: async (command) => { calls.route53.push(command); return { RecordData: answer, ResponseCode: 'NOERROR' }; } },
      dns: {
        resolve4: async (host) => ENDPOINT_IPS[host] ?? [],
        reverse: async (ip) => { if (ptr[ip]) return [ptr[ip]]; throw Object.assign(new Error('nx'), { code: 'ENOTFOUND' }); },
      },
      request: async (opts) => {
        calls.request.push(opts);
        if (requestError) throw requestError;
        return { status: 200, servedRegion: served, latencyMs: 120 };
      },
      fetch: async (url) => { calls.fetch.push(url); return { json: async () => probeBody }; },
    },
  };
}

test.beforeEach(() => resetEndpointCache());

test('requires a session', async () => {
  const res = await demoGeo('GET', null, {}, {});
  assert.equal(res.statusCode, 401);
});

test('GET lists supported countries with representative IPs only', async () => {
  const res = await demoGeo('GET', session, {}, { region: 'ap-southeast-1', probeUrl: '' });
  assert.equal(res.statusCode, 200);
  const data = body(res);
  assert.equal(data.record, RECORD_NAME);
  assert.deepEqual(data.servingRegions, ['ap-southeast-1', 'ap-northeast-1']);
  assert.ok(data.countries.length >= 12);
  assert.equal(new Set(data.countries.map((c) => c.code)).size, data.countries.length);
  for (const c of data.countries) assert.match(c.ip, /^\d+\.\d+\.\d+\.\d+$/);
  // Portal ở Singapore: chỉ SG có request thật; Mỹ cần probe URL.
  assert.deepEqual(data.countries.filter((c) => c.live).map((c) => c.code), ['SG']);
});

test('POST rejects unknown country and wrong method', async () => {
  assert.equal((await demoGeo('POST', session, post('XX'), fakes().deps)).statusCode, 400);
  assert.equal((await demoGeo('POST', session, { body: '{"country":5}' }, fakes().deps)).statusCode, 400);
  assert.equal((await demoGeo('DELETE', session, {}, fakes().deps)).statusCode, 405);
});

test('POST sends TestDNSAnswer with resolver + ECS of the country and requests the returned IP', async () => {
  const { deps, calls } = fakes({ answer: ['18.139.143.59'], served: 'ap-southeast-1' });
  const res = await demoGeo('POST', session, post('de'), deps);
  assert.equal(res.statusCode, 200);
  const de = COUNTRIES.find((c) => c.code === 'DE');
  assert.deepEqual(calls.route53[0].input, {
    HostedZoneId: HOSTED_ZONE_ID, RecordName: RECORD_NAME, RecordType: 'A',
    ResolverIP: de.ip, EDNS0ClientSubnetIP: de.ip, EDNS0ClientSubnetMask: '24',
  });
  assert.deepEqual(calls.request[0], { ip: '18.139.143.59', host: RECORD_NAME, timeoutMs: 4000 });
  const data = body(res);
  assert.equal(data.country, 'DE');
  assert.deepEqual(data.dnsAnswer, ['18.139.143.59']);
  assert.equal(data.chosenRegion, 'ap-southeast-1');
  assert.equal(data.chosenBy, 'endpoint-ip');
  assert.equal(data.servedRegion, 'ap-southeast-1');
  assert.equal(data.match, true);
  assert.deepEqual(data.steps.map((s) => [s.id, s.kind, s.ok]), [['dns', 'simulated', true], ['locate', 'real', true], ['request', 'real', true]]);
  assert.equal(data.live, null);
});

test('falls back to PTR when the IP rotated out of the resolved endpoint set', async () => {
  const { deps } = fakes({ answer: ['54.92.95.254'], served: 'ap-northeast-1', ptr: { '54.92.95.254': 'ec2-54-92-95-254.ap-northeast-1.compute.amazonaws.com' } });
  const data = body(await demoGeo('POST', session, post('KR'), deps));
  assert.equal(data.chosenRegion, 'ap-northeast-1');
  assert.equal(data.chosenBy, 'ptr');
  assert.equal(data.match, true);
});

test('reports mismatch, and does not self-confirm when the IP cannot be located', async () => {
  const mismatch = body(await demoGeo('POST', session, post('KR'), fakes({ answer: ['52.199.84.170'], served: 'ap-southeast-1' }).deps));
  assert.equal(mismatch.chosenRegion, 'ap-northeast-1');
  assert.equal(mismatch.match, false);

  const unknown = body(await demoGeo('POST', session, post('KR'), fakes({ answer: ['1.2.3.4'], served: 'ap-northeast-1' }).deps));
  assert.equal(unknown.chosenRegion, 'ap-northeast-1');
  assert.equal(unknown.chosenBy, 'served-header');
  assert.equal(unknown.match, null);
});

test('Route 53 failure and request failure are reported as failed steps, not 500', async () => {
  const { deps } = fakes();
  deps.route53 = { send: async () => { throw Object.assign(new Error('denied'), { name: 'AccessDenied' }); } };
  const failedDns = body(await demoGeo('POST', session, post('DE'), deps));
  assert.equal(failedDns.steps.length, 1);
  assert.equal(failedDns.steps[0].ok, false);
  assert.match(failedDns.steps[0].detail, /AccessDenied/);

  const failedReq = body(await demoGeo('POST', session, post('DE'), fakes({ requestError: new Error('timeout') }).deps));
  assert.equal(failedReq.servedRegion, null);
  assert.equal(failedReq.match, false);
  assert.match(failedReq.steps.at(-1).detail, /quá 4 giây/);
});

test('live request from the portal region itself uses normal DNS', async () => {
  const { deps, calls } = fakes({ served: 'ap-southeast-1' });
  const data = body(await demoGeo('POST', session, post('SG'), deps));
  assert.equal(calls.request.length, 2);
  assert.deepEqual(calls.request[1], { ip: null, host: RECORD_NAME, timeoutMs: 4000 });
  assert.equal(data.live.source, 'portal-lambda');
  assert.equal(data.live.fromRegion, 'ap-southeast-1');
  assert.equal(data.live.servedRegion, 'ap-southeast-1');
});

test('US uses the us-east-1 probe and sanitizes its answer', async () => {
  const { deps, calls } = fakes({ answer: ['52.199.84.170'], served: 'ap-northeast-1',
    probeBody: { probeRegion: 'us-east-1', sourceIp: '34.204.203.50', status: 200, servedRegion: 'ap-northeast-1', latencyMs: 512.4, extra: '<script>' } });
  const data = body(await demoGeo('POST', session, post('US'), deps));
  assert.deepEqual(calls.fetch, ['https://probe.example/']);
  assert.deepEqual(data.live, { source: 'probe-lambda', fromRegion: 'us-east-1', sourceIp: '34.204.203.50', status: 200, servedRegion: 'ap-northeast-1', latencyMs: 512 });
  assert.equal(data.steps.at(-1).id, 'live');
});

test('probe Lambda reads X-Served-Region from a real HTTP response', async () => {
  const server = createServer((req, res) => { res.setHeader('X-Served-Region', 'ap-northeast-1'); res.end('ok'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    const fakeFetch = (url, init) => fetch(url.startsWith('https://checkip') ? `http://127.0.0.1:${port}/ip` : `http://127.0.0.1:${port}/health`, init);
    const out = await probe(fakeFetch);
    assert.equal(out.status, 200);
    assert.equal(out.servedRegion, 'ap-northeast-1');
    assert.equal(out.sourceIp, null); // body "ok" không phải IP
  } finally { server.close(); }
});
