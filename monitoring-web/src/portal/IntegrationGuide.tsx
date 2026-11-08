import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Tag } from '../components/ui';
import { ENDPOINTS } from '../data/deployment';
import { FailoverDiagram } from './GuideDiagrams';
import { RequestSimulator } from './RequestSimulator';
import { SampleWalkthrough } from './SampleWalkthrough';
import { Snippet } from './Snippet';

function SectionTitle({ number, children }: { number: number; children: string }) {
  return <h2 aria-label={`${number}. ${children}`} className="flex items-center gap-3 font-semibold"><span className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent text-xs font-bold text-on-accent">{number}.</span><span>{children}</span></h2>;
}

const LANGUAGES: [string, string][] = [['node', 'JavaScript'], ['python', 'Python'], ['curl', 'cURL']];

const STEPS: [string, string, string][] = [
  ['guide-register', 'Đăng ký API', 'Khai báo backend HTTPS'],
  ['guide-key', 'Tạo key', 'Chọn API được phép gọi'],
  ['guide-call', 'Gọi proxy', 'Gửi request từ server'],
  ['guide-telemetry', 'Xem telemetry', 'Theo dõi lượt gọi, lỗi'],
];

// Mã và thông báo lấy từ docs/thiet-ke-gateway.md và src/api/proxy.mjs.
const ERRORS: [string, string, string, string][] = [
  ['401', '{"message":"Unauthorized"}', 'API Gateway', 'Thiếu hoặc sai x-api-key. Kiểm tra biến môi trường.'],
  ['403', 'KEY_REVOKED', 'Authorizer', 'Key đã thu hồi. Tạo key mới. Mã này nằm trong log authorizer.'],
  ['403', 'KEY_SCOPE_DENIED', 'Authorizer', 'Key không được phép gọi API này. Tạo key có đúng phạm vi. Mã này nằm trong log authorizer.'],
  ['400', 'BAD_PATH', 'Gateway', 'Đường dẫn không hợp lệ.'],
  ['403', 'API_DISABLED', 'Gateway', 'API đích đang tắt. Bật lại trong tab API đích.'],
  ['403', 'TARGET_BLOCKED', 'Gateway', 'Địa chỉ backend không được phép, ví dụ địa chỉ nội bộ.'],
  ['404', 'API_NOT_FOUND', 'Gateway', 'Sai API ID hoặc API thuộc doanh nghiệp khác.'],
  ['413', 'PAYLOAD_TOO_LARGE', 'Gateway', 'Body request vượt 1 MB.'],
  ['500', 'GATEWAY_INTERNAL', 'Gateway', 'Lỗi nội bộ gateway. Gửi requestId cho nhóm vận hành.'],
  ['502', 'UPSTREAM_UNREACHABLE', 'Gateway', 'Không kết nối được tới backend.'],
  ['502', 'UPSTREAM_TOO_LARGE', 'Gateway', 'Phản hồi của backend vượt 4 MB.'],
  ['504', 'UPSTREAM_TIMEOUT', 'Gateway', 'Backend không phản hồi kịp timeout đã đăng ký.'],
];

const SUCCESS_SAMPLE = `HTTP/1.1 200 OK
Content-Type: application/json
X-Mrapi-Source: upstream

{ "orders": [{ "id": "ORD-1001", "status": "paid" }] }`;
const ERROR_SAMPLE = `HTTP/1.1 504 Gateway Timeout
Content-Type: application/json
X-Mrapi-Source: gateway

{
  "error": "Backend không phản hồi kịp thời gian chờ",
  "code": "UPSTREAM_TIMEOUT",
  "requestId": "EXAMPLE_REQUEST_ID"
}`;

export function IntegrationGuide() {
  const [language, setLanguage] = useState('node');
  return <div className="space-y-4">
    <Card className="hero-card space-y-4"><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold">Từ API của doanh nghiệp đến gateway</h2><Tag tone="warning">Chưa nghiệm thu với key thật</Tag></div>
      <p className="text-sm text-ink2">Ví dụ: doanh nghiệp đã có API đơn hàng. Bạn đăng ký địa chỉ backend đó, tạo key, rồi để server của ứng dụng gọi qua gateway.</p>
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{STEPS.map(([id, title, hint], index) => <li key={id}><a href={`#${id}`} className="flex h-full items-center gap-3 rounded-xl border border-line bg-surface p-3 transition hover:-translate-y-0.5 hover:border-accent"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-on-accent">{index + 1}</span><span><span className="block text-sm font-semibold text-ink">{title}</span><span className="block text-xs text-muted">{hint}</span></span></a></li>)}</ol>
      <p className="text-sm text-ink2">Đã có quản lý tài khoản, API đích và key. Proxy chuyển tiếp và key theo phạm vi API đã triển khai ở hai Region; gọi thiếu hoặc sai key bị từ chối 401. Luồng chuyển tiếp bằng key thật chưa được nghiệm thu. Các ví dụ dưới đây là mẫu tích hợp; chế độ demo không gửi request ra mạng.</p>
    </Card>
    <SampleWalkthrough />
    <Card className="space-y-3"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">Kịch bản trình diễn</h2><Tag>Cho người demo</Tag></div>
      <ol className="list-decimal space-y-2 pl-5 text-sm text-ink2">
        <li>Bấm <strong className="text-ink">Trải nghiệm demo</strong> ở đầu trang. Tài khoản và API mẫu chỉ nằm trong trình duyệt.</li>
        <li>Mở tab <strong className="text-ink">API key</strong>, tạo key cho API mẫu và cho thấy key chỉ hiện một lần.</li>
        <li>Mở <strong className="text-ink">Thử request demo</strong>, lần lượt chọn gọi bình thường, thiếu key và backend lỗi; mỗi lần gửi sẽ có hoạt cảnh request. Sau đó thu hồi key rồi gửi lại.</li>
        <li>Dùng phần mô phỏng và sơ đồ bên dưới để giải thích luồng request và failover.</li>
        <li>Chuyển sang <Link className="text-accent underline" to="/">System Overview</Link>, <Link className="text-accent underline" to="/regions">Multi-Region</Link> và <Link className="text-accent underline" to="/incidents">Failover &amp; Incidents</Link>. Nhìn nhãn ở góc trên để biết đang xem dữ liệu demo hay dữ liệu thật.</li>
      </ol>
    </Card>
    <RequestSimulator />
    <FailoverDiagram />
    <section id="guide-register" className="scroll-mt-20"><Card className="space-y-3"><SectionTitle number={1}>Đăng ký API đích</SectionTitle><p className="text-sm">Mở tab <strong>API đích</strong> → nhập tên, URL HTTPS công khai của backend và timeout → Đăng ký API. Sao chép API ID trong danh sách. URL này là backend đang có của doanh nghiệp, ví dụ <code>https://backend.company.com/v1</code>.</p></Card></section>
    <section id="guide-key" className="scroll-mt-20"><Card className="space-y-3"><SectionTitle number={2}>Lấy API key</SectionTitle><ol className="list-decimal space-y-2 pl-5 text-sm"><li>Mở tab <strong>API key</strong>, nhập tên ứng dụng, ví dụ “Server bán hàng”, rồi chọn API được phép gọi.</li><li>Bấm <strong>Tạo key</strong>, sao chép ngay giá trị đầy đủ trong khung hiện ra.</li><li>Key chỉ được trả về một lần. Nếu mất, tạo key mới và thu hồi key cũ.</li><li>Lưu key vào biến môi trường trên server của doanh nghiệp. Mã key trong danh sách chỉ là ID, không dùng thay secret.</li></ol><p className="text-sm text-ink2">Token đăng nhập portal dùng header Authorization: Bearer; API key gọi gateway dùng x-api-key. Đây là hai giá trị khác nhau. Key demo có tiền tố DEMO_ONLY và không dùng được trên AWS.</p></Card></section>
    <section id="guide-call" className="scroll-mt-20"><Card className="space-y-4"><SectionTitle number={3}>Thêm vào project của doanh nghiệp</SectionTitle><p className="text-sm">Ví dụ gọi GET /orders qua gateway. Thay API ID bằng ID của API đích vừa đăng ký và dán key của bạn vào biến môi trường.</p>
      <Snippet title="Biến môi trường của backend doanh nghiệp (.env)" code={`MRAPI_GATEWAY_URL=${ENDPOINTS.api}\nMRAPI_API_ID=YOUR_REGISTERED_API_ID\nMRAPI_API_KEY=PASTE_YOUR_SECRET_KEY_HERE`} />
      <p className="text-sm text-ink2">Thêm .env vào .gitignore. Không đặt secret vào biến VITE_*, NEXT_PUBLIC_*, React hoặc app mobile. Trình duyệt gọi server của doanh nghiệp; server mới giữ key và gọi gateway.</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Ngôn ngữ mẫu">{LANGUAGES.map(([id, label]) => <button type="button" key={id} aria-pressed={language === id} onClick={() => setLanguage(id)} className={`chip ${language === id ? 'chip-active' : ''}`}>{label}</button>)}</div>
      <Snippet key={language} title="Mẫu gọi gateway" code={language === 'node' ? `// Chạy trên server Node.js; cấu hình biến môi trường trước.\n// Nếu dùng file .env: node --env-file=.env example.mjs\nconst { MRAPI_GATEWAY_URL, MRAPI_API_ID, MRAPI_API_KEY } = process.env;\nif (!MRAPI_GATEWAY_URL || !MRAPI_API_ID || !MRAPI_API_KEY) {\n  throw new Error('Thiếu cấu hình MRAPI');\n}\nconst url = MRAPI_GATEWAY_URL.replace(/\\/$/, '')\n  + '/proxy/' + encodeURIComponent(MRAPI_API_ID) + '/orders';\nconst response = await fetch(url, {\n  headers: { 'x-api-key': MRAPI_API_KEY },\n  signal: AbortSignal.timeout(10000),\n});\nif (!response.ok) throw new Error('Gateway HTTP ' + response.status);\nconsole.log(await response.json());` : language === 'python' ? `# Python: đọc biến môi trường do môi trường chạy cung cấp.\nimport json, os\nfrom urllib.request import Request, urlopen\nfrom urllib.parse import quote\n\nbase = os.environ['MRAPI_GATEWAY_URL'].rstrip('/')\napi_id = quote(os.environ['MRAPI_API_ID'], safe='')\nrequest = Request(\n    f'{base}/proxy/{api_id}/orders',\n    headers={'x-api-key': os.environ['MRAPI_API_KEY']}\n)\nwith urlopen(request, timeout=10) as response:\n    print(json.load(response))` : `# Bash: đặt các biến môi trường ở bước trên trước khi chạy.\ncurl --fail-with-body --max-time 10 \\\n  "$MRAPI_GATEWAY_URL/proxy/$MRAPI_API_ID/orders" \\\n  -H "x-api-key: $MRAPI_API_KEY"`} />
      <div className="grid gap-3 lg:grid-cols-2"><Snippet title="Response mẫu khi thành công" code={SUCCESS_SAMPLE} /><Snippet title="Response mẫu khi gateway báo lỗi" code={ERROR_SAMPLE} /></div>
      <p className="text-xs text-muted">Hai response trên là ví dụ minh họa. Header X-Mrapi-Source cho biết phản hồi đến từ backend (upstream) hay do gateway sinh ra (gateway).</p>
    </Card></section>
    <section id="guide-telemetry" className="scroll-mt-20"><Card className="space-y-3"><SectionTitle number={4}>Xem telemetry</SectionTitle><p className="text-sm">Mở tab <strong>Tổng quan</strong> để xem lượt gọi, lượt lỗi, thời gian xử lý, phân bổ theo Region và theo key của doanh nghiệp. Request bị authorizer từ chối không được tính vì không vào tới proxy.</p><div className="grid gap-2 text-sm sm:grid-cols-3">{[['Theo request', 'requestId, apiId, keyId, method, path, status'], ['Khi có lỗi', 'errorType, ví dụ UPSTREAM_TIMEOUT'], ['Hiệu năng', 'latencyMs, region, timestamp']].map(([title, text]) => <div className="rounded-xl bg-raised p-3" key={title}><p className="font-semibold">{title}</p><p className="mt-1 break-words text-xs text-ink2">{text}</p></div>)}</div><p className="text-sm text-ink2">Telemetry không lưu API key, query string, body hay header.</p></Card></section>
    <Card className="space-y-3"><SectionTitle number={5}>Kiểm tra và xử lý lỗi</SectionTitle><p className="text-sm">Trên gateway thật: thử request hợp lệ → thử thiếu key → thu hồi key và thử lại → kiểm tra thống kê. Với demo, dùng tab “Thử request demo” để xem luồng giả lập này ngay.</p>
      <p className="text-sm text-ink2">Status 2xx, 4xx và 5xx có X-Mrapi-Source: upstream là phản hồi nguyên gốc của backend đích. Các lỗi do nền tảng sinh ra:</p>
      <div className="overflow-x-auto"><table className="w-full min-w-[36rem] text-left text-sm"><thead><tr className="border-b border-line text-xs text-ink2"><th className="p-2">HTTP</th><th className="p-2">Mã hoặc body</th><th className="p-2">Nơi trả lỗi</th><th className="p-2">Cần kiểm tra</th></tr></thead><tbody>{ERRORS.map(([status, code, source, text]) => <tr className="border-b border-line" key={code}><td className="p-2"><span className={`rounded-md px-2 py-0.5 text-xs font-bold ${status.startsWith('5') ? 'bg-critical/15 text-critical' : 'bg-warning/20 text-ink'}`}>{status}</span></td><td className="p-2"><code className="break-all text-xs">{code}</code></td><td className="p-2 text-ink2">{source}</td><td className="p-2 text-ink2">{text}</td></tr>)}</tbody></table></div></Card>
  </div>;
}
