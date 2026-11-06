import { useEffect, useRef, useState } from 'react';
import { Card, Tag } from '../components/ui';
import { Snippet } from './IntegrationGuide';
import { envConfig, requestUrl, sendGatewayRequest, type GatewayResult, type IntegrationApi, type IntegrationKey } from './integration';

const field = 'mt-1 w-full rounded-md border border-line bg-surface p-2 text-sm';
const button = 'rounded-md border border-line bg-raised px-3 py-2 text-sm hover:bg-surface disabled:opacity-50';
type Props = {
  apis: IntegrationApi[]; keys: IntegrationKey[];
  initial?: { secret: string; apiIds: string[] }; onInitialConsumed: () => void; onSent: () => void; onOverview: () => void;
};

export function IntegrationWorkspace({ apis, keys, initial, onInitialConsumed, onSent, onOverview }: Props) {
  const [gateway, setGateway] = useState(import.meta.env.VITE_GATEWAY_URL ?? '');
  const [apiId, setApiId] = useState(initial?.apiIds[0] ?? '');
  const [apiKey, setApiKey] = useState(initial?.secret ?? '');
  const [path, setPath] = useState('/orders');
  const [withoutKey, setWithoutKey] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GatewayResult | null>(null);
  const [language, setLanguage] = useState('node');
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; abort.current?.abort(); }; }, []);
  useEffect(() => { if (initial) onInitialConsumed(); }, [initial, onInitialConsumed]);
  const available = apis.filter(api => api.enabled);
  const selected = available.some(api => api.apiId === apiId) ? apiId : available[0]?.apiId ?? '';
  const scopedKeys = keys.filter(key => key.status === 'active' && key.apiIds?.includes(selected));
  let preview = '', invalid = '';
  try { preview = requestUrl(gateway, selected, path); } catch (err) { invalid = (err as Error).message; }
  function changed() { setError(''); setNotice(''); setResult(null); }
  async function copyConfig() {
    setError(''); setNotice('');
    try { await navigator.clipboard.writeText(envConfig(gateway, selected, apiKey)); setNotice('Đã sao chép cấu hình, bao gồm API key.'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Không sao chép được cấu hình.'); }
  }
  function downloadConfig() {
    setError(''); setNotice('');
    try {
      const content = envConfig(gateway, selected, apiKey);
      const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = 'mrapi.env';
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('Đã tải cấu hình, bao gồm API key. Đổi tên thành .env trong project server của bạn.');
    } catch (err) { setError((err as Error).message); }
  }
  async function send() {
    if (busy) return;
    setError(''); setNotice(''); setResult(null);
    if (invalid) { setError(invalid); return; }
    const secret = withoutKey ? '' : apiKey.trim();
    if (!withoutKey && (!secret || /\s/.test(secret))) { setError('Nhập API key hoặc chọn thử không gửi key.'); return; }
    if (secret.startsWith('DEMO_ONLY')) { setError('Key demo không dùng được với gateway thật.'); return; }
    setBusy(true);
    const controller = new AbortController(); abort.current = controller;
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await sendGatewayRequest(preview, secret, controller.signal);
      if (mounted.current) setResult(response);
      if (mounted.current) onSent();
    } catch {
      if (mounted.current) setError(controller.signal.aborted ? 'Request đã hủy hoặc vượt quá 15 giây.' : 'Không đọc được phản hồi gateway. Kiểm tra kết nối, route proxy và CORS cho origin của web cùng header x-api-key. Không thể xác định HTTP status từ lỗi mạng/CORS.');
    } finally { clearTimeout(timer); if (mounted.current) setBusy(false); }
  }
  return <div className="space-y-4">
    <Card className="space-y-3"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">Cấu hình project & kiểm tra kết nối</h2><Tag tone="accent">Kết nối gateway thật</Tag></div>
      <p className="text-sm text-ink2">Chọn API, dùng key đã cấp và lấy cấu hình cho server của doanh nghiệp. Sau đó kiểm tra GET ngay tại đây, rồi xem thống kê trong Tổng quan.</p>
      {!available.length && <p role="status" className="text-sm text-warning">Chưa có API đang bật. Mở API đích để đăng ký hoặc bật API trước.</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm">Gateway URL<input className={field} type="url" value={gateway} disabled={busy} placeholder="https://gateway.company.com/demo" onChange={event => { setGateway(event.target.value); changed(); }} /></label>
        <label className="text-sm">API của project<select className={field} value={selected} disabled={busy || !available.length} onChange={event => { setApiId(event.target.value); changed(); }}>{!available.length && <option value="">Chưa có API</option>}{available.map(api => <option key={api.apiId} value={api.apiId}>{api.name}</option>)}</select></label>
        <label className="text-sm sm:col-span-2">API key tích hợp<input className={field} type="password" value={apiKey} disabled={busy} autoComplete="off" spellCheck={false} placeholder="Dán key vừa tạo, không dùng token đăng nhập" onChange={event => { setApiKey(event.target.value); changed(); }} /></label>
      </div>
      <p className="text-xs text-muted">API ID: {selected || 'Chưa chọn'} · Key đang có quyền: {scopedKeys.map(key => key.name).join(', ') || 'Chưa có'}. Secret chỉ ở bộ nhớ khi mở bước này; rời bước hoặc đăng xuất sẽ xóa. Danh sách key không thể khôi phục secret.</p>
      <h3 className="text-sm font-semibold">Cấu hình cho project server</h3>
      <pre className="overflow-x-auto rounded border border-line bg-page p-3 text-xs"><code>{`MRAPI_GATEWAY_URL=${gateway || '<URL gateway>'}\nMRAPI_API_ID=${selected || '<API ID>'}\nMRAPI_API_KEY=<key được thêm khi sao chép hoặc tải file>`}</code></pre>
      <div className="flex flex-wrap gap-2"><button className={button} disabled={busy || !selected || !apiKey || !gateway} onClick={() => void copyConfig()}>Sao chép .env có key</button><button className={button} disabled={busy || !selected || !apiKey || !gateway} onClick={downloadConfig}>Tải cấu hình .env</button><button className={button} disabled={busy || !apiKey} onClick={() => { setApiKey(''); changed(); }}>Xóa key khỏi màn hình</button></div>
      <p className="text-sm text-ink2">Đặt file tải về vào project server, đổi tên thành .env và thêm .env vào .gitignore. Chạy lại server sau khi cấu hình. Không đưa key vào VITE_*, NEXT_PUBLIC_* hoặc mã frontend. Website chỉ tạo file cấu hình; bạn cần đưa file đó vào project của mình.</p>
      <label className="block text-sm">Mã tích hợp server<select className={field} value={language} onChange={event => setLanguage(event.target.value)}><option value="node">Node.js</option><option value="python">Python</option></select></label>
      <Snippet key={language} title={language === 'node' ? 'example.mjs — chạy node --env-file=.env example.mjs' : 'example.py — nạp .env vào môi trường server trước khi chạy'} code={language === 'node' ? `const { MRAPI_GATEWAY_URL, MRAPI_API_ID, MRAPI_API_KEY } = process.env;
if (!MRAPI_GATEWAY_URL || !MRAPI_API_ID || !MRAPI_API_KEY) {
  throw new Error('Thiếu cấu hình MRAPI');
}
const url = MRAPI_GATEWAY_URL.replace(/\\/$/, '')
  + '/proxy/' + encodeURIComponent(MRAPI_API_ID) + '/orders';
const response = await fetch(url, {
  headers: { 'x-api-key': MRAPI_API_KEY },
  redirect: 'error', signal: AbortSignal.timeout(15000),
});
console.log('HTTP', response.status);
console.log(await response.text());` : `import os
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError
from urllib.parse import quote

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

opener = build_opener(NoRedirect)
url = (os.environ['MRAPI_GATEWAY_URL'].rstrip('/')
       + '/proxy/' + quote(os.environ['MRAPI_API_ID'], safe='') + '/orders')
request = Request(url, headers={'x-api-key': os.environ['MRAPI_API_KEY']})
try:
    with opener.open(request, timeout=15) as response:
        print(response.status, response.read().decode())
except HTTPError as error:
    print(error.code, error.read().decode())`} />
      <p className="text-xs text-muted">Mẫu gọi /orders; thay bằng đường dẫn có trên backend doanh nghiệp.</p>
      {notice && <p role="status" className="text-sm text-good">{notice}</p>}
    </Card>
    <Card className="space-y-4"><h2 className="font-semibold">Kiểm tra request qua gateway</h2>
      <form className="space-y-3" onSubmit={event => { event.preventDefault(); void send(); }}>
        <label className="block text-sm">Đường dẫn kiểm tra (GET)<input className={field} value={path} disabled={busy} onChange={event => { setPath(event.target.value); changed(); }} placeholder="/orders?limit=10" /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={withoutKey} disabled={busy} onChange={event => { setWithoutKey(event.target.checked); changed(); }} />Thử không gửi API key</label>
        {preview ? <p className="break-all rounded border border-line bg-page p-3 font-mono text-xs">GET {preview}</p> : <p className="text-sm text-muted">{invalid}</p>}
        {<p className="text-sm text-ink2">Nút gửi sẽ gọi URL trên bằng key đã nhập trong header x-api-key. Portal không gửi token đăng nhập hoặc cookie. Gateway cần bật CORS cho web; proxy và authorizer phải được triển khai.</p>}
        <div className="flex flex-wrap gap-2"><button className={button} disabled={busy || !preview}>{busy ? 'Đang gửi…' : 'Gửi GET tới gateway'}</button>{busy && <button type="button" className={button} onClick={() => abort.current?.abort()}>Hủy request</button>}</div>
      </form>
      {error && <p role="alert" className="text-sm text-critical">{error}</p>}
      {result && <div className="space-y-3" role="status"><p className="font-semibold">HTTP {result.status} · {result.durationMs} ms</p><p className="text-sm text-ink2">{result.status >= 200 && result.status < 300 ? 'Request thành công.' : result.status === 401 || result.status === 403 ? 'Kiểm tra key, phạm vi API, trạng thái thu hồi và cấu hình authorizer.' : result.status === 404 ? 'Kiểm tra API ID, đường dẫn và route proxy đã triển khai.' : 'Kiểm tra phản hồi backend và cấu hình gateway.'}</p><p className="text-xs text-muted">Region: {result.region ?? 'Không có header hoặc chưa expose qua CORS'} · Request ID: {result.requestId ?? 'Không có header hoặc chưa expose qua CORS'}</p><pre className="max-h-96 overflow-auto rounded border border-line bg-page p-3 text-xs">{result.body || '(Phản hồi rỗng)'}</pre>{result.truncated && <p className="text-xs text-warning">Chỉ hiển thị 64 KiB đầu của phản hồi.</p>}<button className={button} onClick={onOverview}>Xem thống kê doanh nghiệp</button><p className="text-xs text-muted">Thống kê do backend cung cấp và có thể cập nhật chậm. Request bị authorizer từ chối có thể không đi qua proxy để ghi telemetry.</p></div>}
    </Card>
  </div>;
}
