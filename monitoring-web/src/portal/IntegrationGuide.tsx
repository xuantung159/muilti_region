import { useState } from 'react';
import { Card, Tag } from '../components/ui';

export function Snippet({ title, code }: { title: string; code: string }) {
  const [notice, setNotice] = useState('');
  return <div className="space-y-2"><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">{title}</h3><button type="button" className="rounded border border-line px-3 py-1 text-xs" onClick={async () => {
    try { await navigator.clipboard.writeText(code); setNotice('Đã sao chép'); } catch { setNotice('Hãy chọn và sao chép đoạn mã bên dưới.'); }
  }}>Sao chép mẫu</button></div><pre className="overflow-x-auto rounded-md border border-line bg-page p-3 text-xs leading-6"><code>{code}</code></pre><p role="status" className="text-xs text-muted">{notice}</p></div>;
}

type IntegrationApi = { apiId: string; name: string; enabled: boolean };

export function IntegrationGuide({ apis = [] }: { apis?: IntegrationApi[] }) {
  const [gateway, setGateway] = useState('');
  const [selectedApi, setSelectedApi] = useState('');
  const enabledApis = apis.filter(api => api.enabled);
  const apiId = enabledApis.find(api => api.apiId === selectedApi)?.apiId ?? enabledApis[0]?.apiId ?? 'YOUR_REGISTERED_API_ID';
  let gatewayUrl = '';
  try {
    const url = new URL(gateway.trim());
    if (url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash) gatewayUrl = url.href.replace(/\/+$/, '');
  } catch { /* Chờ người dùng nhập URL hợp lệ. */ }
  const env = `MRAPI_GATEWAY_URL=${gatewayUrl || 'https://YOUR_GATEWAY_HOST/demo'}\nMRAPI_API_ID=${apiId}\nMRAPI_API_KEY=PASTE_YOUR_SECRET_KEY_HERE`;

  const [language, setLanguage] = useState('node');
  return <div className="space-y-4">
    <Card className="space-y-3"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">Từ API của doanh nghiệp đến gateway</h2><Tag tone="warning">Tích hợp gateway</Tag></div>
      <p className="text-sm text-ink2">Ví dụ: doanh nghiệp đã có API đơn hàng. Bạn đăng ký địa chỉ backend đó, tạo key, rồi để server của ứng dụng gọi qua gateway.</p>
      <div className="grid gap-2 text-center text-sm sm:grid-cols-3">{['1. Server doanh nghiệp gửi request + key', '2. Gateway kiểm tra key và chuyển tiếp', '3. API đích xử lý, trả kết quả'].map(step => <div className="rounded-md border border-line bg-raised p-3" key={step}>{step}</div>)}</div>
      <p className="text-sm text-ink2">Đăng ký API đích, cấp key có quyền gọi API đó, rồi mở tab Tích hợp project để tải cấu hình và gửi request thật qua gateway.</p>
    </Card>
    <Card className="space-y-3"><h2 className="font-semibold">1. Đăng ký API đích</h2><p className="text-sm">Mở tab <strong>API đích</strong> → nhập tên, URL HTTPS công khai của backend và timeout → Đăng ký API. Sao chép API ID trong danh sách. URL này là backend đang có của doanh nghiệp, ví dụ <code>https://backend.company.com/v1</code>.</p></Card>
    <Card className="space-y-3"><h2 className="font-semibold">2. Lấy API key</h2><ol className="list-decimal space-y-2 pl-5 text-sm"><li>Mở tab <strong>API key</strong>, nhập tên ứng dụng, ví dụ “Server bán hàng”.</li><li>Chọn các API đích mà ứng dụng được phép gọi.</li><li>Bấm <strong>Tạo key</strong>, sao chép ngay giá trị đầy đủ trong khung hiện ra.</li><li>Key chỉ được trả về một lần. Nếu mất, tạo key mới và thu hồi key cũ.</li><li>Lưu key vào biến môi trường trên server của doanh nghiệp. Mã key trong danh sách chỉ là ID, không dùng thay secret.</li></ol><p className="text-sm text-ink2">Token đăng nhập portal dùng header Authorization: Bearer; API key gọi gateway dùng x-api-key. Đây là hai giá trị khác nhau.</p></Card>
    <Card className="space-y-4"><h2 className="font-semibold">3. Thêm vào project của doanh nghiệp</h2><p className="text-sm">Ví dụ gọi GET /orders qua gateway. Thay URL gateway bằng URL triển khai được nhóm cung cấp và API ID bằng ID của API đích vừa đăng ký.</p>
      <label className="block text-sm">URL gateway đã triển khai<input type="url" className="mt-1 w-full rounded border border-line bg-surface p-2" placeholder="https://gateway.company.com/demo" value={gateway} onChange={event => setGateway(event.target.value)} /></label>
      {gateway && !gatewayUrl && <p role="alert" className="text-sm text-critical">Nhập URL HTTPS của gateway, gồm stage nếu có; không chứa tài khoản, query hoặc fragment.</p>}
      {enabledApis.length > 0 ? <label className="block text-sm">API tích hợp<select className="ml-3 rounded border border-line bg-surface p-2" value={apiId} onChange={event => setSelectedApi(event.target.value)}>{enabledApis.map(api => <option key={api.apiId} value={api.apiId}>{api.name}</option>)}</select></label> : <p className="text-sm text-muted">Đăng nhập và đăng ký API đích đang bật để chọn API ID vào cấu hình.</p>}
      <Snippet title="Biến môi trường của backend doanh nghiệp (.env)" code={env} />
      <p className="text-sm text-ink2">Trên máy chủ của bạn: tạo file .env ở thư mục project, dán cấu hình, thay PASTE_YOUR_SECRET_KEY_HERE bằng key vừa sao chép rồi khởi động lại ứng dụng. Chọn đúng API nằm trong phạm vi key. URL gateway do nhóm vận hành cung cấp, khác URL backend đích.</p>
      <p className="text-sm text-ink2">Thêm .env vào .gitignore. Không đặt secret vào biến VITE_*, NEXT_PUBLIC_*, React hoặc app mobile. Trình duyệt gọi server của doanh nghiệp; server mới giữ key và gọi gateway.</p>
      <label className="block text-sm">Ngôn ngữ mẫu<select className="ml-3 rounded border border-line bg-surface p-2" value={language} onChange={event => setLanguage(event.target.value)}><option value="node">Node.js (server)</option><option value="python">Python (server)</option><option value="curl">cURL</option></select></label>
      <Snippet key={language} title="Mẫu gọi gateway — dùng khi proxy đã triển khai" code={language === 'node' ? `// Chạy trên server Node.js; cấu hình biến môi trường trước.\n// Nếu dùng file .env: node --env-file=.env example.mjs\nconst { MRAPI_GATEWAY_URL, MRAPI_API_ID, MRAPI_API_KEY } = process.env;\nif (!MRAPI_GATEWAY_URL || !MRAPI_API_ID || !MRAPI_API_KEY) {\n  throw new Error('Thiếu cấu hình MRAPI');\n}\nconst url = MRAPI_GATEWAY_URL.replace(/\\/$/, '')\n  + '/proxy/' + encodeURIComponent(MRAPI_API_ID) + '/orders';\nconst response = await fetch(url, {\n  headers: { 'x-api-key': MRAPI_API_KEY },\n  signal: AbortSignal.timeout(10000),\n});\nif (!response.ok) throw new Error('Gateway HTTP ' + response.status);\nconsole.log(await response.json());` : language === 'python' ? `# Python: đọc biến môi trường do môi trường chạy cung cấp.\nimport json, os\nfrom urllib.request import Request, urlopen\nfrom urllib.parse import quote\n\nbase = os.environ['MRAPI_GATEWAY_URL'].rstrip('/')\napi_id = quote(os.environ['MRAPI_API_ID'], safe='')\nrequest = Request(\n    f'{base}/proxy/{api_id}/orders',\n    headers={'x-api-key': os.environ['MRAPI_API_KEY']}\n)\nwith urlopen(request, timeout=10) as response:\n    print(json.load(response))` : `# Bash: đặt các biến môi trường ở bước trên trước khi chạy.\ncurl --fail-with-body --max-time 10 \\\n  "$MRAPI_GATEWAY_URL/proxy/$MRAPI_API_ID/orders" \\\n  -H "x-api-key: $MRAPI_API_KEY"`} />
    </Card>
    <Card className="space-y-3"><h2 className="font-semibold">4. Kiểm tra và xử lý lỗi</h2><p className="text-sm">Mở Tích hợp project để thử request hợp lệ hoặc thiếu key. Sau đó mở Tổng quan để xem dữ liệu telemetry; số liệu tự làm mới mỗi 15 giây. Request gọi trực tiếp backend đích không đi qua gateway nên không được tính.</p><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-line"><th className="p-2">Kết quả dự kiến</th><th className="p-2">Cần kiểm tra</th></tr></thead><tbody>{[['2xx', 'Request được backend đích xử lý thành công.'], ['401 / 403', 'Thiếu key, sai key, key đã thu hồi hoặc thiếu quyền.'], ['404', 'Sai API ID, đường dẫn hoặc route proxy.'], ['5xx / timeout', 'Backend đích, timeout hoặc lỗi gateway.']].map(([code, text]) => <tr className="border-b border-line" key={code}><td className="p-2">{code}</td><td className="p-2">{text}</td></tr>)}</tbody></table></div></Card>
  </div>;
}
