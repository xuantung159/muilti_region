import { useState } from 'react';
import { Card, Tag } from '../components/ui';
import { ENDPOINTS } from '../data/deployment';
import { Snippet } from './Snippet';

// Hướng dẫn cho doanh nghiệp đã có backend đang chạy: không tạo project mới, chỉ đổi cấu hình
// và một chỗ khởi tạo HTTP client. Các giới hạn lấy từ src/api/proxy.mjs và src/dashboard/apis.mjs.

const OLD_BASE = 'https://backend.company.com/v1';

function Step({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return <Card className="space-y-3">
    <h3 className="flex items-center gap-3 text-base leading-snug font-semibold"><span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent text-xs font-bold tabular-nums text-on-accent">{number}</span><span className="min-w-0">{title}</span></h3>
    {children}
  </Card>;
}

const CLIENTS: { id: string; label: string; file: string; before: string; after: string }[] = [
  {
    id: 'node', label: 'Node.js (axios)', file: 'src/lib/ordersClient.js',
    before: `import axios from 'axios';

export const orders = axios.create({
  baseURL: '${OLD_BASE}',
  timeout: 10000,
});`,
    after: `import axios from 'axios';

const { MRAPI_GATEWAY_URL, MRAPI_API_ID, MRAPI_API_KEY } = process.env;
const viaGateway = Boolean(MRAPI_GATEWAY_URL && MRAPI_API_ID && MRAPI_API_KEY);

export const orders = axios.create({
  baseURL: viaGateway
    ? MRAPI_GATEWAY_URL.replace(/\\/$/, '') + '/proxy/' + encodeURIComponent(MRAPI_API_ID)
    : '${OLD_BASE}', // chưa cấu hình gateway thì gọi thẳng như cũ
  timeout: 10000,
  headers: viaGateway ? { 'x-api-key': MRAPI_API_KEY } : {},
});

// Chỗ gọi API giữ nguyên:
// await orders.get('/orders', { params: { status: 'paid' } });`,
  },
  {
    id: 'python', label: 'Python (requests)', file: 'app/clients/orders.py',
    before: `import requests

BASE_URL = '${OLD_BASE}'
session = requests.Session()`,
    after: `import os
from urllib.parse import quote
import requests

session = requests.Session()
gw = os.getenv('MRAPI_GATEWAY_URL')
api_id = os.getenv('MRAPI_API_ID')
key = os.getenv('MRAPI_API_KEY')

if gw and api_id and key:
    BASE_URL = f"{gw.rstrip('/')}/proxy/{quote(api_id, safe='')}"
    session.headers['x-api-key'] = key
else:
    BASE_URL = '${OLD_BASE}'  # chưa cấu hình gateway thì gọi thẳng như cũ

# Chỗ gọi API giữ nguyên:
# session.get(f'{BASE_URL}/orders', params={'status': 'paid'}, timeout=10)`,
  },
  {
    id: 'java', label: 'Java (Spring Boot)', file: 'OrdersClientConfig.java + application.yml',
    before: `@Bean
RestClient ordersClient() {
  return RestClient.builder()
      .baseUrl("${OLD_BASE}")
      .build();
}`,
    after: `# application.yml
mrapi:
  gateway-url: \${MRAPI_GATEWAY_URL:}
  api-id: \${MRAPI_API_ID:}
  api-key: \${MRAPI_API_KEY:}

// OrdersClientConfig.java
@Bean
RestClient ordersClient(@Value("\${mrapi.gateway-url}") String gw,
                        @Value("\${mrapi.api-id}") String apiId,
                        @Value("\${mrapi.api-key}") String key) {
  if (gw.isBlank() || apiId.isBlank() || key.isBlank()) {
    return RestClient.builder().baseUrl("${OLD_BASE}").build();
  }
  return RestClient.builder()
      .baseUrl(gw.replaceAll("/+$", "") + "/proxy/" + apiId)
      .defaultHeader("x-api-key", key)
      .build();
}

// Service giữ nguyên:
// ordersClient.get().uri("/orders").retrieve().body(String.class);`,
  },
  {
    id: 'go', label: 'Go (net/http)', file: 'internal/orders/client.go',
    before: `var client = &http.Client{Timeout: 10 * time.Second}
const baseURL = "${OLD_BASE}"`,
    after: `type apiKeyTransport struct {
	key  string
	next http.RoundTripper
}

func (t apiKeyTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.Header.Set("x-api-key", t.key)
	return t.next.RoundTrip(r)
}

func NewClient() (*http.Client, string) {
	gw, id, key := os.Getenv("MRAPI_GATEWAY_URL"), os.Getenv("MRAPI_API_ID"), os.Getenv("MRAPI_API_KEY")
	if gw == "" || id == "" || key == "" {
		return &http.Client{Timeout: 10 * time.Second}, "${OLD_BASE}"
	}
	return &http.Client{Timeout: 10 * time.Second, Transport: apiKeyTransport{key, http.DefaultTransport}},
		strings.TrimRight(gw, "/") + "/proxy/" + url.PathEscape(id)
}

// Chỗ gọi API giữ nguyên: client.Get(baseURL + "/orders")`,
  },
  {
    id: 'dotnet', label: '.NET (HttpClient)', file: 'Program.cs',
    before: `builder.Services.AddHttpClient("orders", c =>
    c.BaseAddress = new Uri("${OLD_BASE}/"));`,
    after: `builder.Services.AddHttpClient("orders", c =>
{
    var gw = builder.Configuration["MRAPI_GATEWAY_URL"];
    var apiId = builder.Configuration["MRAPI_API_ID"];
    var key = builder.Configuration["MRAPI_API_KEY"];
    if (string.IsNullOrEmpty(gw) || string.IsNullOrEmpty(apiId) || string.IsNullOrEmpty(key))
    {
        c.BaseAddress = new Uri("${OLD_BASE}/");
        return;
    }
    c.BaseAddress = new Uri($"{gw.TrimEnd('/')}/proxy/{Uri.EscapeDataString(apiId)}/");
    c.DefaultRequestHeaders.Add("x-api-key", key);
});

// Chỗ gọi giữ nguyên, đường dẫn không có "/" ở đầu:
// await http.GetAsync("orders");`,
  },
];

const ENV_PLACES: [string, string][] = [
  ['Máy lập trình', 'File .env ở thư mục gốc, thêm .env vào .gitignore. Node 20+: node --env-file=.env; Python: python-dotenv; Spring/.NET: biến môi trường của IDE hoặc terminal.'],
  ['Docker', 'docker run --env-file .env … hoặc khối environment: / env_file: trong docker-compose.yml.'],
  ['Server Linux', 'Environment= trong file systemd, hoặc env trong ecosystem.config.js của PM2.'],
  ['Cloud', 'Mục Environment variables của dịch vụ (AWS Lambda/ECS, Render, Railway…); key production nên để trong secret manager (vd. AWS Secrets Manager).'],
];

export function ExistingProjectGuide() {
  const [client, setClient] = useState('node');
  const active = CLIENTS.find((c) => c.id === client) ?? CLIENTS[0];
  const gw = ENDPOINTS.api;
  return <div className="space-y-4">
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="guide-eyebrow">DỰ ÁN ĐANG CHẠY</p><h2 className="mt-1 text-lg font-semibold">Đưa API có sẵn ra sau gateway</h2></div><Tag tone="accent">Không viết lại backend · Đổi cấu hình 1 chỗ</Tag></div>
      <p className="text-sm text-ink2">Backend của doanh nghiệp giữ nguyên. Chỉ các nơi <strong className="text-ink">gọi</strong> API đó (server khác, job, service nội bộ) đổi địa chỉ sang gateway và gửi kèm API key.</p>
      <div className="grid gap-2 text-sm sm:grid-cols-2">
        <div className="rounded-xl bg-raised p-3"><p className="text-xs font-semibold text-ink2">TRƯỚC</p><p className="mt-1 break-all font-mono text-xs">Server của bạn → {OLD_BASE}/orders</p></div>
        <div className="rounded-xl bg-raised p-3"><p className="text-xs font-semibold text-ink2">SAU</p><p className="mt-1 break-all font-mono text-xs">Server của bạn → {gw}/proxy/API_ID/orders + x-api-key → gateway (Singapore/Tokyo) → {OLD_BASE}/orders</p></div>
      </div>
      <p className="text-sm text-ink2"><strong className="text-ink">Cần có:</strong> backend có URL HTTPS công khai (không phải localhost hay IP nội bộ), tài khoản Cổng doanh nghiệp. Backend đang chạy trên máy cá nhân thì mở tạm qua tunnel như <code>cloudflared tunnel --url http://127.0.0.1:8080</code>.</p>
    </Card>

    <Step number={1} title="Đăng ký backend đang có làm API đích">
      <ol className="list-decimal space-y-1.5 pl-5 text-sm"><li>Mở tab <strong>API đích</strong>, nhập tên và <strong>Base URL</strong>: phần chung đứng trước mọi route, ví dụ <code>{OLD_BASE}</code>.</li><li>Chọn timeout (1–10 giây) lớn hơn thời gian xử lý chậm nhất của backend.</li><li>Bấm Đăng ký API, sao chép <strong>API ID</strong> (dạng <code>a</code> + 32 ký tự hex).</li></ol>
      <p className="text-sm text-ink2">Gateway ghép phần sau <code>/proxy/API_ID</code> vào sau Base URL, giữ nguyên method, query và body:</p>
      <div className="overflow-x-auto"><table className="w-full min-w-[34rem] text-left text-xs"><thead><tr className="border-b border-line text-ink2"><th className="p-2 font-medium">Đang gọi</th><th className="p-2 font-medium">Đổi thành</th></tr></thead><tbody>
        {[['GET /v1/orders', 'GET /proxy/API_ID/orders'], ['GET /v1/orders/42?expand=items', 'GET /proxy/API_ID/orders/42?expand=items'], ['POST /v1/orders (body JSON)', 'POST /proxy/API_ID/orders (body như cũ)'], ['DELETE /v1/orders/42', 'DELETE /proxy/API_ID/orders/42']].map(([from, to]) => <tr key={from} className="border-b border-line last:border-0"><td className="p-2 font-mono">{from}</td><td className="p-2 font-mono">{to}</td></tr>)}
      </tbody></table></div>
    </Step>

    <Step number={2} title="Tạo API key cho từng ứng dụng, từng môi trường">
      <p className="text-sm">Tab <strong>API key</strong> → đặt tên rõ nơi dùng (vd. “order-service production”) → chọn đúng API vừa đăng ký → Tạo key → sao chép ngay, key chỉ hiện một lần.</p>
      <p className="text-sm text-ink2">Dùng key riêng cho dev, staging, production và cho từng service gọi. Khi lộ một key chỉ cần thu hồi key đó, và trang Tổng quan lọc được lưu lượng theo từng key.</p>
    </Step>

    <Step number={3} title="Thêm 3 biến môi trường vào nơi chạy project">
      <Snippet title=".env (hoặc mục Environment variables của server)" code={`MRAPI_GATEWAY_URL=${gw}\nMRAPI_API_ID=API_ID_VUA_SAO_CHEP\nMRAPI_API_KEY=KEY_MRK_VUA_TAO`} />
      <div className="grid gap-2 text-sm sm:grid-cols-2">{ENV_PLACES.map(([place, how]) => <div key={place} className="rounded-xl border border-line p-3"><p className="font-semibold">{place}</p><p className="mt-1 text-xs text-ink2">{how}</p></div>)}</div>
      <p className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm"><strong>Không</strong> đặt key vào code frontend, biến <code>VITE_*</code>/<code>NEXT_PUBLIC_*</code>, app mobile hay commit lên git. Nếu ứng dụng chỉ có frontend, thêm một endpoint nhỏ ở server của bạn để server giữ key và gọi gateway.</p>
    </Step>

    <Step number={4} title="Sửa đúng một chỗ: nơi khởi tạo HTTP client">
      <p className="text-sm text-ink2">Đổi base URL và gắn header <code>x-api-key</code> ở chỗ tạo client dùng chung; mọi lời gọi API khác giữ nguyên. Khi chưa có biến môi trường, client vẫn gọi thẳng backend như cũ, nên có thể deploy code trước rồi bật gateway sau.</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Ngôn ngữ của project">{CLIENTS.map((c) => <button type="button" key={c.id} aria-pressed={client === c.id} onClick={() => setClient(c.id)} className={`chip min-h-10 ${client === c.id ? 'chip-active' : ''}`}>{c.label}</button>)}</div>
      <div className="grid gap-3 xl:grid-cols-2">
        <Snippet key={`${active.id}-before`} title={`Trước · ${active.file}`} code={active.before} />
        <Snippet key={`${active.id}-after`} title={`Sau · ${active.file}`} code={active.after} />
      </div>
    </Step>

    <Step number={5} title="Kiểm tra header backend đang dùng">
      <div className="grid gap-2 text-sm sm:grid-cols-3">
        <div className="rounded-xl bg-raised p-3"><p className="font-semibold">Chuyển nguyên tới backend</p><p className="mt-1 text-xs text-ink2">Method, đường dẫn con, query, body (tối đa 1 MB), Content-Type và các header tự đặt khác.</p></div>
        <div className="rounded-xl border border-warning/40 bg-warning/10 p-3"><p className="font-semibold">Gateway bỏ đi</p><p className="mt-1 text-xs text-ink2"><code>x-api-key</code>, <code>Authorization</code>, <code>Cookie</code>, <code>Host</code>, <code>X-Forwarded-*</code>.</p></div>
        <div className="rounded-xl bg-raised p-3"><p className="font-semibold">Gateway thêm vào</p><p className="mt-1 text-xs text-ink2">Gửi backend: <code>X-Request-Id</code>. Trả client: <code>X-Request-Id</code>, <code>X-Mrapi-Source</code>, <code>X-Served-Region</code>.</p></div>
      </div>
      <p className="text-sm text-ink2">Nếu backend đang xác thực người dùng bằng <code>Authorization: Bearer …</code> hoặc cookie, phía gọi cần gửi token đó qua một header riêng (vd. <code>X-User-Token</code>) và backend đọc header này. Response tối đa 4 MB; backend phản hồi chậm hơn timeout đã đăng ký sẽ nhận 504.</p>
    </Step>

    <Step number={6} title="Đối chiếu trước khi chuyển hẳn">
      <Snippet title="PowerShell · đặt biến như bước 3 rồi chạy" code={`# 1. Gọi thẳng backend như hiện tại\ncurl.exe -i ${OLD_BASE}/orders\n\n# 2. Gọi qua gateway: body phải giống (1), có thêm X-Served-Region\ncurl.exe -i "$env:MRAPI_GATEWAY_URL/proxy/$env:MRAPI_API_ID/orders" -H "x-api-key: $env:MRAPI_API_KEY"\n\n# 3. Thiếu key: phải nhận HTTP 401\ncurl.exe -i "$env:MRAPI_GATEWAY_URL/proxy/$env:MRAPI_API_ID/orders"`} />
      <p className="text-sm text-ink2">Chạy test sẵn có của project với biến môi trường đã bật, rồi mở tab <strong>Tổng quan</strong> để thấy request theo key và theo Region. Bảng mã lỗi nằm ở mục <strong>Tham khảo</strong>.</p>
    </Step>

    <Step number={7} title="Đưa lên production, quay lại và đổi key">
      <ul className="list-disc space-y-1.5 pl-5 text-sm">
        <li><strong>Bật:</strong> deploy code ở bước 4, sau đó thêm 3 biến môi trường cho production và khởi động lại service.</li>
        <li><strong>Quay lại:</strong> xóa 3 biến và khởi động lại; client tự gọi thẳng backend như trước, không cần deploy lại code.</li>
        <li><strong>Đổi key định kỳ:</strong> tạo key mới → cập nhật <code>MRAPI_API_KEY</code> → khởi động lại → kiểm tra Tổng quan có request bằng key mới → thu hồi key cũ.</li>
        <li><strong>Giới hạn cần biết:</strong> gateway chưa gửi kèm secret riêng cho backend, nên ai biết URL backend vẫn gọi thẳng được. API key bảo vệ đường đi qua gateway; backend vẫn nên giữ cơ chế xác thực của chính nó.</li>
      </ul>
    </Step>
  </div>;
}
