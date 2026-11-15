import { createShop, viaGateway } from './lib/shopClient.js';

// So sánh từ CÙNG một máy, CÙNG lúc: Route 53 tự chọn Region gần nhất  vs  ép mọi request về Singapore.
// Hai chế độ gửi xen kẽ từng request nên chịu chung điều kiện mạng.
//
// Đo 2 loại request:
//  - /health      : chỉ client ↔ gateway, không qua backend → thấy rõ lợi ích chọn Region gần.
//  - /proxy/...   : request thật của shop (client → gateway → backend). Độ trễ còn gồm chặng
//                   Region → backend, nên nếu backend ở gần Singapore thì Tokyo có thể không nhanh hơn.
if (!viaGateway) { console.error('Cần MRAPI_GATEWAY_URL, MRAPI_API_ID, MRAPI_API_KEY'); process.exit(1); }

const ROUNDS = Number(process.env.ROUNDS ?? 20);
const PIN = process.env.COMPARE_PIN ?? 'ap-southeast-1';
const modes = [
  { name: 'Tự chọn (Route 53)', client: createShop() },
  { name: `Ép ${PIN === 'ap-southeast-1' ? 'Singapore' : PIN}`, client: createShop({ pinRegion: PIN }) },
];
const healthUrl = process.env.MRAPI_GATEWAY_URL.replace(/\/$/, '') + '/health';
const kinds = [
  ['/health (chỉ gateway)', c => c.get(healthUrl, { baseURL: '' })],
  ['/proxy GET /products', c => c.get('/products')],
];

const stats = {}; // stats[kind][mode] = { ms: [], region: {}, status: {} }
const rec = (k, m) => ((stats[k] ??= {})[m] ??= { ms: [], region: {}, status: {} });

async function measure(kind, call, mode) {
  const s = rec(kind, mode.name);
  const t = performance.now();
  try {
    const res = await call(mode.client);
    const ms = Math.round(performance.now() - t);
    const region = res.headers['x-served-region'] ?? '-';
    s.ms.push(ms);
    s.region[region] = (s.region[region] ?? 0) + 1;
    s.status[res.status] = (s.status[res.status] ?? 0) + 1;
    return `${mode.name.padEnd(20)} ${res.status} ${region.padEnd(15)} ${String(ms).padStart(5)} ms`;
  } catch (err) {
    s.status[err.code ?? 'ERR'] = (s.status[err.code ?? 'ERR'] ?? 0) + 1;
    return `${mode.name.padEnd(20)} ${err.code ?? 'ERR'} ${err.message}`;
  }
}

const ip = await fetch('https://checkip.amazonaws.com').then(r => r.text()).catch(() => '?');
console.log(`IP gửi request: ${ip.trim()}   |   ${ROUNDS} vòng × ${kinds.length} loại × ${modes.length} chế độ\n`);

// Làm nóng: mở sẵn kết nối TLS cho cả hai chế độ, không tính vào kết quả.
for (const m of modes) for (const [, call] of kinds) await call(m.client).catch(() => {});

for (let r = 1; r <= ROUNDS; r++) {
  for (const [kind, call] of kinds) {
    // Đảo thứ tự mỗi vòng để chế độ nào đi trước cũng không được lợi.
    const order = r % 2 ? modes : [...modes].reverse();
    for (const m of order) console.log(`#${String(r).padStart(2)} ${kind.padEnd(22)} ${await measure(kind, call, m)}`);
  }
}

const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
console.log('\n================ KẾT QUẢ ================');
for (const [kind] of kinds) {
  console.log(`\n${kind}`);
  console.log('  Chế độ               Region phục vụ                    TB     p50     p95');
  const avg = {};
  for (const m of modes) {
    const s = stats[kind]?.[m.name];
    if (!s?.ms.length) { console.log(`  ${m.name.padEnd(20)} (không có số liệu)`, s?.status); continue; }
    const a = [...s.ms].sort((x, y) => x - y);
    avg[m.name] = a.reduce((x, y) => x + y, 0) / a.length;
    const regions = Object.entries(s.region).map(([k, v]) => `${k}×${v}`).join(' ');
    console.log(`  ${m.name.padEnd(20)} ${regions.padEnd(30)} ${String(Math.round(avg[m.name])).padStart(5)} ${String(pct(a, 0.5)).padStart(7)} ${String(pct(a, 0.95)).padStart(7)} ms`);
  }
  const [auto, pinned] = modes.map(m => avg[m.name]);
  const sameRegion = Object.keys(stats[kind]?.[modes[0].name]?.region ?? {}).join() === Object.keys(stats[kind]?.[modes[1].name]?.region ?? {}).join();
  if (auto && pinned && sameRegion) {
    console.log('  → Hai chế độ cùng về một Region (máy này vốn gần Region đó nhất): chênh lệch chỉ là nhiễu mạng.');
  } else if (auto && pinned) {
    const diff = pinned - auto;
    console.log(`  → Định tuyến theo vị trí ${diff >= 0 ? 'nhanh hơn' : 'chậm hơn'} ${Math.abs(Math.round(diff))} ms/request (${Math.abs(Math.round(diff / pinned * 100))}%)`);
  }
}
