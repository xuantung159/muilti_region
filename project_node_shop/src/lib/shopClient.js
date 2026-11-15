import axios from 'axios';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';

// Bước 4 của hướng dẫn: chỉ sửa nơi khởi tạo HTTP client dùng chung.
// Có đủ 3 biến môi trường thì đi qua gateway Multi-Region, thiếu thì gọi thẳng backend như cũ.
const { MRAPI_GATEWAY_URL, MRAPI_API_ID, MRAPI_API_KEY, MRAPI_PIN_REGION, BACKEND_URL = 'http://localhost:8081' } = process.env;
export const viaGateway = Boolean(MRAPI_GATEWAY_URL && MRAPI_API_ID && MRAPI_API_KEY);

// Đích Alias của hai record Latency (infra/route53/api-latency-records.json).
// Ghim DNS về một đích = mô phỏng hệ thống KHÔNG có định tuyến theo vị trí, mọi client về cùng một Region.
// Domain, chứng chỉ TLS, đường dẫn, Lambda đều giữ nguyên; chỉ khác bước Route 53 chọn Region.
export const REGION_TARGETS = {
  'ap-southeast-1': 'd-zd1hv50jn0.execute-api.ap-southeast-1.amazonaws.com',
  'ap-northeast-1': 'd-csqvriesoh.execute-api.ap-northeast-1.amazonaws.com',
};

// Endpoint execute-api của từng Region (có stage). Trình duyệt không ghim DNS được như Node, nên khi failover
// phía trình duyệt thì gửi lại thẳng vào endpoint này (CORS đã bật ở cả hai Region).
export const REGION_ENDPOINTS = {
  'ap-southeast-1': 'https://43vakggyh5.execute-api.ap-southeast-1.amazonaws.com/demo',
  'ap-northeast-1': 'https://n39r5pits8.execute-api.ap-northeast-1.amazonaws.com/demo',
};

// Keep-alive giữ kết nối TCP/TLS để khỏi bắt tay lại ở mỗi request. Nhưng kết nối còn sống thì
// không phân giải DNS lại, nên sau failover client sẽ dính mãi Region cũ. Vì vậy cứ 10 s đổi sang
// agent mới để request kế tiếp hỏi lại DNS (TTL record Route 53 là 60 s).
const AGENT_TTL_MS = 10_000;

// Failover phía client: Route 53 cần khoảng 1 phút mới chuyển DNS. Trong lúc đó, request gặp lỗi do chính
// Region (5xx không có X-Served-Region: Lambda proxy không chạy được) được gửi lại ngay sang Region kia, vẫn
// cùng domain và chứng chỉ, chỉ đổi đích Alias. Sau đó ghim Region kia FAILOVER_HOLD_MS rồi thả về Route 53.
const FAILOVER_HOLD_MS = 30_000;
const SAFE_METHODS = new Set(['get', 'head', 'options']);
// 5xx do backend thì proxy vẫn gắn X-Served-Region; thiếu header nghĩa là lỗi trước khi tới proxy.
const regionDown = res => res.status >= 500 && !res.headers['x-served-region'];

/**
 * Tạo client gọi shop.
 * pinRegion: bỏ trống = Route 53 tự chọn Region gần nhất; 'ap-southeast-1' = luôn về Singapore.
 */
export function createShop({ pinRegion = '' } = {}) {
  if (pinRegion && !REGION_TARGETS[pinRegion]) throw new Error(`MRAPI_PIN_REGION không hợp lệ: ${pinRegion}`);
  const lookupFor = region => (_host, opts, cb) => dns.lookup(REGION_TARGETS[region], opts, cb);
  const lookup = pinRegion ? lookupFor(pinRegion) : undefined;
  const newAgents = () => ({
    http: new http.Agent({ keepAlive: true }),
    https: new https.Agent({ keepAlive: true, ...(lookup && { lookup }) }),
    // Agent ghim từng Region, dùng cho failover phía client.
    region: Object.fromEntries(Object.keys(REGION_TARGETS).map(r => [r, new https.Agent({ keepAlive: true, lookup: lookupFor(r) })])),
  });
  const destroyAgents = a => [a.http, a.https, ...Object.values(a.region)].forEach(agent => agent.destroy());
  let agents = newAgents();
  let agentsBornAt = Date.now();
  let lastRegion = null; // Region phục vụ request thành công gần nhất (qua Route 53)
  let failover = null; // { region, until } khi đang ghim Region dự phòng

  const client = axios.create({
    baseURL: viaGateway
      ? MRAPI_GATEWAY_URL.replace(/\/$/, '') + '/proxy/' + encodeURIComponent(MRAPI_API_ID)
      : BACKEND_URL, // chưa cấu hình gateway thì gọi thẳng backend như cũ
    timeout: 10000,
    headers: viaGateway ? { 'x-api-key': MRAPI_API_KEY } : {},
    validateStatus: () => true, // tự xử lý mã lỗi
  });
  client.routingMode = pinRegion ? `ép ${pinRegion}` : 'Route 53 tự chọn';

  client.interceptors.request.use((config) => {
    if (Date.now() - agentsBornAt > AGENT_TTL_MS) {
      const old = agents;
      agents = newAgents();
      agentsBornAt = Date.now();
      // Đóng agent cũ sau khi các request đang chạy chắc chắn đã xong (timeout 10 s).
      setTimeout(() => destroyAgents(old), 15_000).unref();
    }
    if (failover && Date.now() > failover.until) {
      console.log(`[failover] hết ${FAILOVER_HOLD_MS / 1000} s ghim ${failover.region}, trả về Route 53 chọn Region`);
      failover = null;
    }
    // mrapiRegion: Region bị ép cho lần gửi lại; không có thì dùng Region đang ghim do failover (nếu có).
    const region = pinRegion ? null : config.mrapiRegion ?? failover?.region;
    config.mrapiRegion = region ?? undefined;
    config.httpAgent = agents.http;
    config.httpsAgent = region ? agents.region[region] : agents.https;
    return config;
  });

  // Gửi lại sang Region khác Region vừa lỗi. Trả response đầu tiên không phải lỗi Region; hết lựa chọn thì trả null.
  async function retryElsewhere(config, reason) {
    const failed = config.mrapiRegion ?? lastRegion;
    for (const region of Object.keys(REGION_TARGETS).filter(r => r !== failed)) {
      try {
        const res = await client.request({ ...config, mrapiRegion: region, mrapiRetried: true });
        if (regionDown(res)) continue;
        if (failover?.region !== region) console.log(`[failover] ${failed ?? 'Region hiện tại'} lỗi (${reason}), chuyển sang ${region} trong ${FAILOVER_HOLD_MS / 1000} s`);
        failover = { region, until: Date.now() + FAILOVER_HOLD_MS };
        res.headers['x-mrapi-client-failover'] = `${failed ?? 'unknown'}->${region}`;
        return res;
      } catch { /* thử Region kế tiếp */ }
    }
    return null;
  }

  client.interceptors.response.use(async (res) => {
    if (pinRegion || res.config.mrapiRetried) return res;
    if (!regionDown(res)) {
      if (!res.config.mrapiRegion && res.headers['x-served-region']) lastRegion = res.headers['x-served-region'];
      return res;
    }
    // Gateway trả 5xx trước khi tới proxy: request chưa tới backend nên gửi lại an toàn với mọi method.
    return (await retryElsewhere(res.config, `HTTP ${res.status}`)) ?? res;
  }, async (err) => {
    // Lỗi mạng/timeout: không biết request đã tới backend chưa, nên chỉ gửi lại method không sửa dữ liệu.
    const config = err.config;
    if (pinRegion || !config || config.mrapiRetried || !SAFE_METHODS.has(config.method)) throw err;
    const res = await retryElsewhere(config, err.code ?? err.message);
    if (res) return res;
    throw err;
  });
  return client;
}

// Client dùng chung cho web.js / traffic.js. Đặt MRAPI_PIN_REGION=ap-southeast-1 để chạy chế độ đối chứng.
export const shop = createShop({ pinRegion: viaGateway ? MRAPI_PIN_REGION ?? '' : '' });
