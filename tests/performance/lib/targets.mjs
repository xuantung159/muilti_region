// Đích test và cổng an toàn. Mọi URL/key lấy từ biến môi trường, không hardcode, không in API key.
//
//   direct → BASE_URL_DIRECT  (backend doanh nghiệp gọi thẳng, path = PERF_PATH)
//   sg     → BASE_URL_SG      (regional invoke URL Singapore, .../demo)
//   tokyo  → BASE_URL_TOKYO   (regional invoke URL Tokyo, .../demo)
//   entry  → BASE_URL_ENTRY   (custom domain qua Route 53 latency routing)
// Với sg/tokyo/entry: path = /proxy/${API_ID}${PERF_PATH}, header x-api-key = API_KEY.
// Cùng PERF_METHOD / PERF_PATH / PERF_BODY cho mọi đích để so sánh công bằng.

export const TARGETS = {
  direct: { env: 'BASE_URL_DIRECT', gateway: false, label: 'A. Backend trực tiếp' },
  sg: { env: 'BASE_URL_SG', gateway: true, label: 'B. Gateway Singapore (regional)' },
  tokyo: { env: 'BASE_URL_TOKYO', gateway: true, label: 'C. Gateway Tokyo (regional)' },
  entry: { env: 'BASE_URL_ENTRY', gateway: true, label: 'D. Entry đa Region (Route 53)' },
};

export const isLocalHost = host => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host) || host.endsWith('.localhost');

export function buildRequest({ target, baseUrl, scenario, env = process.env }) {
  let gateway = false; let label = 'custom';
  if (!baseUrl) {
    const t = TARGETS[target];
    if (!t) throw new Error(`target không hợp lệ: ${target}. Dùng: ${Object.keys(TARGETS).join(', ')} hoặc --base-url`);
    baseUrl = env[t.env];
    if (!baseUrl) throw new Error(`Chưa đặt ${t.env}`);
    gateway = t.gateway; label = t.label;
  }
  const base = new URL(baseUrl.replace(/\/$/, ''));
  let path = env.PERF_PATH || '/orders';
  if (!path.startsWith('/')) path = `/${path}`;
  if (gateway) {
    if (!env.API_ID) throw new Error('Đích gateway cần API_ID (apiId đăng ký trên portal).');
    path = `/proxy/${encodeURIComponent(env.API_ID)}${path}`;
  }
  const url = new URL(base.href.replace(/\/$/, '') + path);
  for (const [k, v] of Object.entries(scenario.query ?? {})) url.searchParams.set(k, v);
  const headers = { 'user-agent': 'mrapi-perf/1.0' };
  if (env.PERF_BODY) headers['content-type'] = 'application/json';
  if (gateway) {
    if (!env.API_KEY) throw new Error('Đích gateway cần API_KEY (không được in ra).');
    headers['x-api-key'] = env.API_KEY;
  }
  return { url: url.href, method: env.PERF_METHOD || 'GET', headers, body: env.PERF_BODY || undefined,
    host: url.hostname, local: isLocalHost(url.hostname), label, gateway };
}

// Bản sao an toàn để ghi vào file kết quả / in ra màn hình.
export const redact = req => ({ ...req, headers: Object.fromEntries(Object.entries(req.headers)
  .map(([k, v]) => [k, k.toLowerCase() === 'x-api-key' || k.toLowerCase() === 'authorization' ? '***' : v])) });

// Trả về danh sách lỗi chặn chạy (rỗng = được chạy).
export function safetyCheck({ req, scenario, peak, target, env = process.env }) {
  const problems = [];
  if (!req.local && env.PERF_CONFIRM_OWNED !== '1')
    problems.push(`Host ${req.host} không phải local. Chỉ test endpoint của chính dự án; xác nhận bằng PERF_CONFIRM_OWNED=1.`);
  if ((scenario.highLoad || peak > 100) && env.ALLOW_HIGH_LOAD !== '1')
    problems.push(`Kịch bản "${scenario.name}" đạt ${peak} RPS: cần ALLOW_HIGH_LOAD=1 và sự đồng ý của người phụ trách tài khoản AWS.`);
  if (scenario.entryOnly && target !== 'entry' && !req.local)
    problems.push(`Kịch bản "${scenario.name}" chỉ có nghĩa với --target entry (Route 53).`);
  return problems;
}
