// Đo failover: mỗi INTERVAL_MS gửi song song hai loại request và ghi CSV.
//  - dns: kết nối mới mỗi lần tới https://api.multi-region.io.vn/health, phân giải DNS bằng resolver của máy
//    (giống client không có failover phía client) -> thấy khi nào Route 53 đổi Region.
//  - client: request /products qua shopClient (đổi kết nối 10 s + gửi lại sang Region kia khi Region lỗi).
// Chạy: node --env-file=.env src/failover-probe.js [số giây] > file.csv
import https from 'node:https';
import { shop } from './lib/shopClient.js';

const SECONDS = Number(process.argv[2] ?? 300);
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 3000);
const HOST = new URL(process.env.MRAPI_GATEWAY_URL ?? 'https://api.multi-region.io.vn').host;

function freshHealth() {
  return new Promise((resolve) => {
    const t = performance.now();
    const req = https.get({ host: HOST, path: '/health', agent: false, timeout: 10_000 }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, region: res.headers['x-served-region'] ?? '-', ip: res.socket?.remoteAddress ?? '-', ms: Math.round(performance.now() - t) }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ status: e.code ?? 'ERR', region: '-', ip: '-', ms: Math.round(performance.now() - t) }));
  });
}

async function viaClient() {
  const t = performance.now();
  try {
    const res = await shop.get('/products');
    return { status: res.status, region: res.headers['x-served-region'] ?? '-', failover: res.headers['x-mrapi-client-failover'] ?? '', ms: Math.round(performance.now() - t) };
  } catch (e) {
    return { status: e.code ?? 'ERR', region: '-', failover: '', ms: Math.round(performance.now() - t) };
  }
}

console.log('time,dns_status,dns_region,dns_ip,dns_ms,client_status,client_region,client_failover,client_ms');
const end = Date.now() + SECONDS * 1000;
while (Date.now() < end) {
  const started = Date.now();
  const [d, c] = await Promise.all([freshHealth(), viaClient()]);
  console.log([new Date(started).toISOString(), d.status, d.region, d.ip, d.ms, c.status, c.region, c.failover, c.ms].join(','));
  await new Promise((r) => setTimeout(r, Math.max(0, INTERVAL_MS - (Date.now() - started))));
}
process.exit(0);
