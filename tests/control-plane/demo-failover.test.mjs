import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
process.env.CONTROL_TABLE = 'mrapi-control';
process.env.AWS_REGION = 'ap-southeast-1';
const { demoFailover, resetDemoFailoverCache, LIMITS } = await import('../../src/dashboard/demo-failover.mjs');
const { outageActive, OUTAGE_KEY } = await import('../../src/shared/outage.mjs');

const SG = 'ap-southeast-1';
const TYO = 'ap-northeast-1';
const IPS = { [SG]: '13.0.0.1', [TYO]: '54.0.0.1' };
const keyOf = (k) => `${k.PK}|${k.SK}`;

// Bảng control giả: đủ cho GetItem và PutItem có ConditionExpression dùng trong demo-failover.
function fakeDb() {
  const items = new Map();
  const calls = [];
  return {
    items,
    calls,
    async send(command) {
      const name = command.constructor.name;
      const input = command.input;
      calls.push({ name, input });
      assert.equal(input.TableName, 'mrapi-control');
      if (name === 'GetCommand') return { Item: items.get(keyOf(input.Key)) };
      if (name === 'PutCommand') {
        const existing = items.get(keyOf(input.Item));
        const values = input.ExpressionAttributeValues ?? {};
        const cond = input.ConditionExpression;
        let ok = true;
        if (cond === 'attribute_not_exists(PK) OR cooldownUntil < :now') ok = !existing || existing.cooldownUntil < values[':now'];
        else if (cond === 'attribute_not_exists(PK) OR #count = :used') ok = !existing || existing.count === values[':used'];
        else if (cond === '#until = :until') ok = existing?.until === values[':until'];
        else if (cond) throw new Error(`unexpected condition ${cond}`);
        if (!ok) throw Object.assign(new Error('failed'), { name: 'ConditionalCheckFailedException' });
        items.set(keyOf(input.Item), structuredClone(input.Item));
        return {};
      }
      throw new Error(`unexpected ${name}`);
    },
  };
}

// Route 53 giả: health check theo `health`, TestDNSAnswer theo vị trí và Region còn khoẻ.
function fakeRoute53(health) {
  const calls = [];
  return {
    calls,
    async send(command) {
      const name = command.constructor.name;
      calls.push(name);
      if (name === 'GetHealthCheckStatusCommand') {
        const region = command.input.HealthCheckId.startsWith('c7') ? SG : TYO;
        const status = health[region] ? 'Success: HTTP Status Code 200' : 'Failure: HTTP Status Code 503';
        return { HealthCheckObservations: Array.from({ length: 8 }, () => ({ StatusReport: { Status: status } })) };
      }
      if (name === 'TestDNSAnswerCommand') {
        assert.equal(command.input.RecordName, 'api.multi-region.io.vn');
        const near = ['203.113.131.1', '3.78.206.104'].includes(command.input.ResolverIP) ? SG : TYO;
        const region = health[near] ? near : near === SG ? TYO : SG;
        return { RecordData: [IPS[region]], ResponseCode: 'NOERROR' };
      }
      throw new Error(`unexpected ${name}`);
    },
  };
}

let db, health, route53, clock, deps;
const session = { tenantId: 'tenant-a', orgName: 'A' };
const call = async (method, body, who = session) => {
  const res = await demoFailover(method, who, { body: body ? JSON.stringify(body) : undefined }, deps);
  return { status: res.statusCode, body: JSON.parse(res.body) };
};

beforeEach(() => {
  resetDemoFailoverCache();
  db = fakeDb();
  health = { [SG]: true, [TYO]: true };
  route53 = fakeRoute53(health);
  clock = Date.parse('2026-11-11T03:00:00Z');
  deps = {
    db, route53, now: () => clock,
    resolve4: async () => [IPS[health[SG] ? SG : TYO]],
    fetchHealth: async (ip) => ({ status: 200, servedRegion: ip === IPS[SG] ? SG : TYO, latencyMs: 12 }),
  };
});

test('GET khi bình thường: idle, mỗi nước về Region gần, request thật ở Singapore', async () => {
  const { status, body } = await call('GET');
  assert.equal(status, 200);
  assert.equal(body.phase, 'idle');
  assert.equal(body.outage, null);
  assert.equal(body.canStart, true);
  assert.deepEqual(body.healthChecks.map((c) => c.status), ['healthy', 'healthy']);
  assert.deepEqual(body.dns.map((d) => [d.id, d.answeredRegion]), [['vn', SG], ['de', SG], ['kr', TYO], ['us', TYO]]);
  assert.equal(body.probe.servedRegion, SG);
  assert.equal(body.probe.ip, IPS[SG]);
  assert.equal(body.timeline.length, 6);
  assert.deepEqual(body.quota, { used: 0, max: LIMITS.dailyPerTenant });
});

test('POST bật giả lập, theo dõi failover rồi tự hết hạn', async () => {
  const started = await call('POST', { region: SG, minutes: 5 });
  assert.equal(started.status, 201);
  assert.equal(started.body.outage.region, SG);
  assert.equal(started.body.outage.remainingSeconds, 300);
  assert.equal(started.body.outage.startedByMe, true);
  assert.equal(started.body.phase, 'waiting_unhealthy');
  assert.equal(started.body.canStart, false);
  const item = db.items.get(keyOf(OUTAGE_KEY));
  assert.equal(item.until - item.startedAt, 5 * 60_000);
  assert.equal(item.startedBy, 'tenant-a');
  assert.equal(outageActive(item, SG, clock), true);
  assert.equal(outageActive(item, TYO, clock), false);

  // Route 53 thấy Singapore lỗi → mọi nước về Tokyo.
  health[SG] = false;
  clock += 150_000;
  resetDemoFailoverCache();
  const failed = await call('GET');
  assert.equal(failed.body.phase, 'failed_over');
  assert.deepEqual([...new Set(failed.body.dns.map((d) => d.answeredRegion))], [TYO]);
  assert.equal(failed.body.probe.servedRegion, TYO);
  assert.equal(failed.body.outage.remainingSeconds, 150);

  // Hết hạn: cờ hết hiệu lực, đang hồi phục, rồi cooldown.
  clock += 151_000;
  resetDemoFailoverCache();
  const ended = await call('GET');
  assert.equal(ended.body.outage, null);
  assert.equal(outageActive(item, SG, clock), false);
  assert.equal(ended.body.phase, 'recovering');
  assert.equal(ended.body.canStart, false);
  health[SG] = true;
  resetDemoFailoverCache();
  const back = await call('GET');
  assert.equal(back.body.phase, 'cooldown');
  assert.equal(back.body.lastOutage.region, SG);
  clock += LIMITS.cooldownMinutes * 60_000;
  resetDemoFailoverCache();
  const idle = await call('GET');
  assert.equal(idle.body.phase, 'idle');
  assert.equal(idle.body.canStart, true);
});

test('luật an toàn: một sự cố mỗi lúc, không bao giờ cả hai Region, kiểm tra đầu vào', async () => {
  assert.equal((await call('POST', { region: 'us-east-1' })).status, 400);
  assert.equal((await call('POST', { region: SG, minutes: 1 })).status, 400);
  assert.equal((await call('POST', { region: SG, minutes: 11 })).status, 400);
  assert.equal((await call('POST', { region: SG, minutes: '5' })).status, 400);

  // Region còn lại không Healthy → từ chối.
  health[TYO] = false;
  const blocked = await call('POST', { region: SG });
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /Tokyo/);
  assert.equal(db.items.has(keyOf(OUTAGE_KEY)), false);
  health[TYO] = true;

  const ok = await call('POST', { region: SG });
  assert.equal(ok.status, 201);
  assert.equal(db.items.get(keyOf(OUTAGE_KEY)).until - clock, LIMITS.defaultMinutes * 60_000);
  // Sự cố thứ hai (bất kỳ Region, bất kỳ ai) bị từ chối.
  assert.equal((await call('POST', { region: TYO }, { tenantId: 'tenant-b' })).status, 409);
  assert.equal(db.items.get(keyOf(OUTAGE_KEY)).region, SG);
});

test('race: ghi có điều kiện chặn lần bật thứ hai dù lần đọc trước thấy trống', async () => {
  const realSend = db.send.bind(db);
  let injected = false;
  db.send = async (command) => {
    // Ngay trước khi ghi cờ, một yêu cầu khác đã ghi xong.
    if (!injected && command.constructor.name === 'PutCommand' && command.input.Item.SK === 'SIMULATED_OUTAGE') {
      injected = true;
      db.items.set(keyOf(OUTAGE_KEY), { ...OUTAGE_KEY, region: TYO, startedAt: clock, until: clock + 300_000, cooldownUntil: clock + 480_000 });
    }
    return realSend(command);
  };
  const res = await call('POST', { region: SG });
  assert.equal(res.status, 409);
  assert.equal(db.items.get(keyOf(OUTAGE_KEY)).region, TYO);
});

test('DELETE kết thúc sớm, giữ thời gian hồi phục; ai đăng nhập cũng kết thúc được', async () => {
  await call('POST', { region: TYO, minutes: 8 });
  clock += 60_000;
  const res = await call('DELETE', undefined, { tenantId: 'tenant-b' });
  assert.equal(res.status, 200);
  assert.equal(res.body.outage, null);
  assert.equal(res.body.cooldown.remainingSeconds, LIMITS.cooldownMinutes * 60);
  const item = db.items.get(keyOf(OUTAGE_KEY));
  assert.equal(item.until, clock);
  assert.equal(item.endedBy, 'tenant-b');
  assert.equal(outageActive(item, TYO, clock), false);
  assert.equal(res.body.lastOutage.endedEarlyAt, new Date(clock).toISOString());
  // DELETE lần nữa không lỗi.
  assert.equal((await call('DELETE')).status, 200);
  assert.equal((await call('POST', { region: SG })).status, 409);
});

test('hạn mức mỗi tài khoản mỗi ngày; admin không bị giới hạn', async () => {
  for (let i = 0; i < LIMITS.dailyPerTenant; i += 1) {
    assert.equal((await call('POST', { region: SG, minutes: 3 })).status, 201);
    clock += 3 * 60_000;
    await call('DELETE');
    clock += LIMITS.cooldownMinutes * 60_000 + 1;
  }
  const limited = await call('POST', { region: SG, minutes: 3 });
  assert.equal(limited.status, 429);
  resetDemoFailoverCache();
  assert.equal((await call('GET')).body.canStart, false);
  assert.equal((await call('POST', { region: SG, minutes: 3 }, { tenantId: 'tenant-a', role: 'admin' })).status, 201);
});

test('405 với method khác; Route 53 lỗi thì trạng thái unknown và không cho bật', async () => {
  assert.equal((await call('PATCH')).status, 405);
  deps.route53 = { async send() { throw Object.assign(new Error('x'), { name: 'Throttling' }); } };
  const res = await call('GET');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.healthChecks.map((c) => c.status), ['unknown', 'unknown']);
  assert.ok(res.body.dns.every((d) => d.error && d.answeredRegion === null));
  assert.equal((await call('POST', { region: SG })).status, 409);
});

test('outageActive bỏ qua cờ quá dài hoặc thiếu hạn', () => {
  const now = Date.now();
  assert.equal(outageActive({ region: SG, until: now + 60 * 60_000 }, SG, now), false);
  assert.equal(outageActive({ region: SG }, SG, now), false);
  assert.equal(outageActive(null, SG, now), false);
  assert.equal(outageActive({ region: SG, until: now + 60_000 }, SG, now), true);
});
