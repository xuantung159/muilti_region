import { shop, viaGateway } from './lib/shopClient.js';

// Các thao tác của một service bán hàng; chỗ gọi API không biết gì về gateway.
const actions = [
  ['GET danh sách sản phẩm', 5, () => shop.get('/products')],
  ['GET tìm kiếm', 3, () => shop.get('/products', { params: { q: pick(['áo', 'tai nghe', 'bàn phím', 'sổ']) } })],
  ['GET chi tiết sản phẩm', 4, () => shop.get(`/products/${rand(1, 5)}`)],
  ['PUT cập nhật tồn kho', 1, () => shop.put(`/products/${rand(1, 5)}`, { stock: rand(10, 300) })],
  ['GET sản phẩm không tồn tại (404 thật)', 1, () => shop.get(`/products/${rand(5000, 9999)}`)],
];

// `--loop` (npm run traffic:loop) hoặc TOTAL=0: gửi liên tục tới khi bấm Ctrl+C, vẫn in tổng kết.
const FOREVER = process.argv.includes('--loop') || process.env.TOTAL === '0';
const TOTAL = Number(process.env.TOTAL ?? 300);
let stopping = false;
process.on('SIGINT', () => {
  if (stopping) process.exit(130); // bấm Ctrl+C lần hai thì thoát ngay
  stopping = true;
  console.log('\nĐang dừng, chờ các request đang chạy…');
});
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 4);
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = list => list[rand(0, list.length - 1)];
const weighted = actions.flatMap(a => Array(a[1]).fill(a));
const stats = { status: {}, region: {}, ms: [] };

async function one(i) {
  const [name, , call] = pick(weighted);
  const t = performance.now();
  try {
    const res = await call();
    const ms = Math.round(performance.now() - t);
    const region = res.headers['x-served-region'] ?? '-';
    stats.status[res.status] = (stats.status[res.status] ?? 0) + 1;
    stats.region[region] = (stats.region[region] ?? 0) + 1;
    stats.ms.push(ms);
    console.log(`#${String(i).padStart(3)} ${res.status} ${region.padEnd(15)} ${String(ms).padStart(4)} ms  ${name}`);
  } catch (err) {
    stats.status[err.code ?? 'ERR'] = (stats.status[err.code ?? 'ERR'] ?? 0) + 1;
    console.log(`#${String(i).padStart(3)} ${err.code ?? 'ERR'} ${name}: ${err.message}`);
  }
}

// IP mà gateway sẽ thấy: trang Định tuyến theo vị trí suy ra quốc gia từ chính IP này (GeoLite2).
const ip = await fetch('https://checkip.amazonaws.com').then(r => r.text()).catch(() => '?');
console.log(`IP gửi request: ${ip.trim()}`);
console.log(viaGateway ? `Qua gateway (${shop.routingMode}): ${shop.defaults.baseURL}` :'Chưa có biến môi trường: gọi thẳng backend');
if (FOREVER) console.log('Gửi liên tục, bấm Ctrl+C để dừng.');
let next = 1;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (!stopping && (FOREVER || next <= TOTAL)) { const i = next++; await one(i); await new Promise(r => setTimeout(r, rand(100, 600))); }
}));
const sorted = stats.ms.sort((a, b) => a - b);
console.log('\nTổng kết');
console.log('  Mã trạng thái:', stats.status);
console.log('  Region xử lý:', stats.region);
if (sorted.length) console.log(`  Độ trễ: trung bình ${Math.round(sorted.reduce((s, x) => s + x, 0) / sorted.length)} ms, p95 ${sorted[Math.floor(sorted.length * 0.95)]} ms`);
