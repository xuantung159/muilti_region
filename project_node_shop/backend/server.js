// Backend sản phẩm của "doanh nghiệp": REST CRUD, lưu thật vào data/products.json.
// Đây là backend có sẵn; nó không biết gì về gateway. Mở ra Internet bằng cloudflared để làm API đích.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.BACKEND_PORT ?? 8081);
const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'products.json');

const SEED = [
  { name: 'Áo thun cotton', category: 'Thời trang', price: 199000, stock: 120 },
  { name: 'Tai nghe Bluetooth', category: 'Điện tử', price: 890000, stock: 35 },
  { name: 'Bình giữ nhiệt 500ml', category: 'Gia dụng', price: 249000, stock: 60 },
  { name: 'Bàn phím cơ', category: 'Điện tử', price: 1450000, stock: 18 },
  { name: 'Sổ tay A5', category: 'Văn phòng phẩm', price: 45000, stock: 300 },
];

let products;
let writing = Promise.resolve();

async function load() {
  try {
    products = JSON.parse(await readFile(FILE, 'utf8'));
  } catch {
    const now = new Date().toISOString();
    products = SEED.map((p, i) => ({ id: i + 1, ...p, createdAt: now, updatedAt: now }));
    await save();
  }
}

// Ghi tuần tự, qua file tạm rồi đổi tên, để không hỏng file khi có request đồng thời.
function save() {
  writing = writing.then(async () => {
    await mkdir(dirname(FILE), { recursive: true });
    await writeFile(FILE + '.tmp', JSON.stringify(products, null, 2));
    await rename(FILE + '.tmp', FILE);
  });
  return writing;
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 100_000) throw Object.assign(new Error('Body quá lớn'), { status: 413 });
  }
  try { return raw ? JSON.parse(raw) : {}; } catch { throw Object.assign(new Error('Body không phải JSON'), { status: 400 }); }
}

// Trả lỗi đầu tiên tìm thấy, hoặc null. partial = true cho PATCH-like update (PUT ở đây cho phép thiếu trường).
function validate(input, partial) {
  const out = {};
  if (!partial || input.name !== undefined) {
    const name = String(input.name ?? '').trim();
    if (!name || name.length > 100) return ['Tên sản phẩm bắt buộc, tối đa 100 ký tự'];
    out.name = name;
  }
  if (!partial || input.category !== undefined) {
    const category = String(input.category ?? '').trim();
    if (!category || category.length > 50) return ['Danh mục bắt buộc, tối đa 50 ký tự'];
    out.category = category;
  }
  for (const field of ['price', 'stock']) {
    if (!partial || input[field] !== undefined) {
      const value = Number(input[field]);
      if (!Number.isInteger(value) || value < 0 || value > 1_000_000_000) return [`${field === 'price' ? 'Giá' : 'Tồn kho'} phải là số nguyên không âm`];
      out[field] = value;
    }
  }
  return [null, out];
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'health') return send(res, 200, { ok: true });
  if (parts[0] !== 'products' || parts.length > 2) return send(res, 404, { error: 'Không có đường dẫn này' });

  if (parts.length === 1) {
    if (req.method === 'GET') {
      const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
      const category = url.searchParams.get('category') ?? '';
      const items = products.filter(p => (!q || p.name.toLowerCase().includes(q)) && (!category || p.category === category));
      return send(res, 200, { total: items.length, products: items, categories: [...new Set(products.map(p => p.category))].sort() });
    }
    if (req.method === 'POST') {
      const [error, data] = validate(await readBody(req), false);
      if (error) return send(res, 400, { error });
      const now = new Date().toISOString();
      const product = { id: products.reduce((m, p) => Math.max(m, p.id), 0) + 1, ...data, createdAt: now, updatedAt: now };
      products.push(product);
      await save();
      return send(res, 201, product);
    }
    return send(res, 405, { error: 'Method không hỗ trợ' });
  }

  const id = Number(parts[1]);
  const index = products.findIndex(p => p.id === id);
  if (index < 0) return send(res, 404, { error: `Không tìm thấy sản phẩm #${parts[1]}` });
  if (req.method === 'GET') return send(res, 200, products[index]);
  if (req.method === 'PUT') {
    const [error, data] = validate(await readBody(req), true);
    if (error) return send(res, 400, { error });
    products[index] = { ...products[index], ...data, updatedAt: new Date().toISOString() };
    await save();
    return send(res, 200, products[index]);
  }
  if (req.method === 'DELETE') {
    const [removed] = products.splice(index, 1);
    await save();
    return send(res, 200, { deleted: removed.id });
  }
  return send(res, 405, { error: 'Method không hỗ trợ' });
}

await load();
createServer((req, res) => {
  const started = Date.now();
  handle(req, res)
    .catch(err => send(res, err.status ?? 500, { error: err.status ? err.message : 'Lỗi máy chủ' }))
    .finally(() => console.log(`${new Date().toISOString()} ${req.method} ${req.url} → ${res.statusCode} (${Date.now() - started} ms)`));
}).listen(PORT, () => console.log(`Backend sản phẩm: http://localhost:${PORT} (dữ liệu: ${FILE})`));
