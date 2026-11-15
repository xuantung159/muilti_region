// Backend giả lập CHỈ chạy local, dùng cho load test và kịch bản upstream timeout.
//
//   node tests/performance/mock-upstream.mjs            # cổng 18080
//   PORT=0 node tests/performance/mock-upstream.mjs     # cổng ngẫu nhiên, in ra stdout
//
// Mọi đường dẫn đều trả JSON. Query hỗ trợ:
//   ?delay=<ms>    chờ trước khi trả lời (tối đa 60000)
//   ?status=<code> mã HTTP trả về (100-599, mặc định 200)
//   ?size=<bytes>  độ dài trường padding trong body (tối đa 1 MB)
// GET /health luôn trả 200 ngay. Không đọc biến môi trường nào khác, không gọi ra ngoài.
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const clampInt = (v, lo, hi, dflt) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };

export function createMockUpstream() {
  return createServer((req, res) => {
    const url = new URL(req.url, 'http://local');
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('{"status":"ok","service":"perf-mock"}');
      }
      const delay = clampInt(url.searchParams.get('delay'), 0, 60_000, 0);
      const status = clampInt(url.searchParams.get('status'), 100, 599, 200);
      const size = clampInt(url.searchParams.get('size'), 0, 1_048_576, 0);
      const reply = () => {
        if (res.destroyed) return;
        const body = JSON.stringify({ source: 'perf-mock', method: req.method, path: url.pathname, delayMs: delay,
          receivedBytes: Buffer.concat(chunks).length, padding: 'x'.repeat(size) });
        res.writeHead(status, { 'Content-Type': 'application/json', 'X-Served-Region': 'local-mock' });
        res.end(body);
      };
      // delay=0 trả lời ngay: trên Windows setTimeout có độ phân giải ~15,6 ms khi tiến trình rảnh,
      // nếu luôn dùng setTimeout thì mock tự cộng thêm ~15 ms vào mọi request.
      if (delay === 0) return reply();
      const timer = setTimeout(reply, delay);
      res.on('close', () => clearTimeout(timer));
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number.parseInt(process.env.PORT ?? '18080', 10);
  const server = createMockUpstream();
  server.keepAliveTimeout = 30_000;
  server.listen(port, '127.0.0.1', () => {
    // Dòng đầu tiên trên stdout là JSON để local-smoke.mjs đọc cổng.
    console.log(JSON.stringify({ listening: `http://127.0.0.1:${server.address().port}` }));
  });
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
