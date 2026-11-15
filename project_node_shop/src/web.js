// Web CRUD sản phẩm. Trình duyệt chỉ gọi /api/* của server này; server giữ API key
// và gọi backend qua gateway Multi-Region bằng shopClient (key không bao giờ xuống trình duyệt).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createShop, shop, viaGateway, REGION_ENDPOINTS } from './lib/shopClient.js';

// Hệ thống "bình thường" để so sánh: chỉ một Region cố định, không định tuyến theo vị trí, không failover.
// Cùng gateway, cùng backend, cùng key; chỉ khác bước chọn Region.
export const SINGLE_REGION = 'ap-southeast-1';
const singleShop = viaGateway ? createShop({ pinRegion: SINGLE_REGION }) : null;

const PORT = Number(process.env.WEB_PORT ?? 3000);
const PUBLIC_KEY = process.env.MRAPI_PUBLIC_KEY ?? '';
const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

function json(res, status, body, extra = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : undefined;
}

async function api(req, res, url) {
  if (url.pathname === '/api/info') {
    // healthUrls: trình duyệt đo chặng trình duyệt → gateway (không qua backend) tới domain chung và từng Region.
    const healthUrls = viaGateway ? { multi: new URL(shop.defaults.baseURL).origin + '/health',
      ...Object.fromEntries(Object.entries(REGION_ENDPOINTS).map(([r, base]) => [r, base + '/health'])) } : null;
    const info = { viaGateway, singleRegion: viaGateway ? SINGLE_REGION : null, healthUrls, target: viaGateway ? new URL(shop.defaults.baseURL).host + new URL(shop.defaults.baseURL).pathname : shop.defaults.baseURL };
    // Chế độ trình duyệt gọi thẳng gateway: Route 53 chọn Region theo vị trí của người xem.
    // MRAPI_PUBLIC_KEY là key công khai riêng cho demo (ai mở web cũng thấy), không phải key production.
    // regionBases: đích gửi lại khi Region đang phục vụ trình duyệt bị lỗi (failover phía trình duyệt).
    if (viaGateway && PUBLIC_KEY) {
      const proxyPath = new URL(shop.defaults.baseURL).pathname;
      const regionBases = Object.fromEntries(Object.entries(REGION_ENDPOINTS).map(([r, base]) => [r, base + proxyPath]));
      Object.assign(info, { browserDirect: true, gatewayBase: shop.defaults.baseURL, regionBases, publicKey: PUBLIC_KEY });
    }
    return json(res, 200, info);
  }
  // Chỉ chuyển tiếp tài nguyên products, không cho trình duyệt gọi đường dẫn tùy ý qua key của server.
  const path = url.pathname.slice('/api'.length);
  if (!/^\/products(\/\d+)?$/.test(path) || !['GET', 'POST', 'PUT', 'DELETE'].includes(req.method)) {
    return json(res, 404, { error: 'Không có đường dẫn này' });
  }
  const single = singleShop && req.headers['x-mrapi-single-region'] === '1';
  const started = Date.now();
  const upstream = await (single ? singleShop : shop).request({ method: req.method, url: path + url.search, data: await readBody(req) });
  const meta = {
    'X-Served-Region': upstream.headers['x-served-region'] ?? (viaGateway ? 'unknown' : 'direct'),
    'X-Upstream-Ms': String(Date.now() - started),
  };
  const body = typeof upstream.data === 'object' && upstream.data !== null ? upstream.data : { error: String(upstream.data || 'Không có nội dung') };
  console.log(`${single ? '[1 Region] ' : ''}${req.method} ${path}${url.search} → ${upstream.status} via ${meta['X-Served-Region']} (${meta['X-Upstream-Ms']} ms)`);
  json(res, upstream.status, body, meta);
}

async function staticFile(res, pathname) {
  const file = normalize(join(PUBLIC, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC)) return json(res, 403, { error: 'Cấm' });
  try {
    const content = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(content);
  } catch {
    json(res, 404, { error: 'Không tìm thấy' });
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else await staticFile(res, url.pathname);
  } catch (err) {
    console.error(err);
    json(res, 502, { error: err.code === 'ECONNABORTED' ? 'Gateway/backend trả lời quá chậm' : 'Không gọi được backend: ' + err.message });
  }
}).listen(PORT, () => {
  console.log(`Web CRUD: http://localhost:${PORT}`);
  console.log(viaGateway ? `Gọi backend qua gateway: ${shop.defaults.baseURL}` : `Chưa cấu hình gateway: gọi thẳng ${shop.defaults.baseURL}`);
  if (viaGateway && PUBLIC_KEY) console.log('Trình duyệt gọi thẳng gateway bằng MRAPI_PUBLIC_KEY (Region theo vị trí người xem)');
});
