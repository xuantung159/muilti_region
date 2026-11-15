import { Loader2, Send } from 'lucide-react';
import { useState } from 'react';
import type { portalCall } from './client';
import { Card, Tag } from '../components/ui';
import { DEMO_SAMPLE_KEYS } from './demo';
import { RequestSimulator } from './RequestSimulator';

type Result = { status: number; steps: string[]; body: unknown };
// Chọn hoạt cảnh theo status mà client demo trả về.
const simulationFor = (status: number, scenario: string) => status === 200 ? 'success' : status === 401 ? (scenario === 'missing' ? 'missing' : 'badkey') : status === 403 ? 'revoked' : status === 502 ? 'upstream' : null;
const SAMPLE_SECRETS = new Set(Object.values(DEMO_SAMPLE_KEYS));
// Đường dẫn minh họa theo API: API Todo demo dùng /todos/1 giống bài thực hành.
const pathFor = (apiId: string) => apiId === 'demo-todo' ? '/todos/1' : '/orders';

export function DemoRequest({ call, token, apis, onSent }: { call: typeof portalCall; token: string; apis: { apiId: string; name: string }[]; onSent: () => void }) {
  const [apiId, setApiId] = useState('');
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [scenario, setScenario] = useState('success');
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [run, setRun] = useState(0);
  const animation = result && simulationFor(result.status, scenario);
  const selected = apis.some(api => api.apiId === apiId) ? apiId : apis[0]?.apiId ?? '';
  // Mặc định dùng key mẫu đúng phạm vi API đang chọn; key người dùng tự dán thì giữ nguyên.
  const key = apiKey ?? DEMO_SAMPLE_KEYS[selected] ?? DEMO_SAMPLE_KEYS['demo-orders'];
  const field = 'mt-1 block w-full min-w-0 rounded-md border border-line bg-surface p-2 text-sm disabled:opacity-60';
  const reset = () => { setResult(null); setError(''); };
  return <Card className="space-y-4"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">Thử request demo</h2><Tag tone="warning">Mô phỏng trong trình duyệt</Tag></div>
    <p className="text-sm text-ink2">Dùng key mẫu có sẵn hoặc dán key DEMO_ONLY vừa tạo. Không gửi key thật vào đây. Request không gọi AWS hay backend đích.</p>
    <form className="grid gap-4 sm:grid-cols-2" aria-busy={busy} onSubmit={async event => {
      event.preventDefault();
      if (busy) return;
      setBusy(true); setError('');
      try {
        const response = await call<Result>('demo/request', token, 'POST', { apiId: selected, apiKey: scenario === 'missing' ? '' : key, upstreamError: scenario === 'upstream' });
        setResult(response); setRun(value => value + 1); onSent();
      } catch (err) {
        setResult(null); setError(err instanceof Error ? err.message : 'Không gửi được request mô phỏng.');
      } finally { setBusy(false); }
    }}>
      <label className="min-w-0 text-sm">API đích demo<select className={field} value={selected} disabled={busy} onChange={event => { setApiId(event.target.value); if (apiKey !== null && SAMPLE_SECRETS.has(apiKey)) setApiKey(null); reset(); }}>{apis.map(api => <option key={api.apiId} value={api.apiId}>{api.name}</option>)}</select></label>
      <label className="min-w-0 text-sm">API key demo<input className={`${field} font-mono`} value={key} disabled={busy} spellCheck={false} onChange={event => { setApiKey(event.target.value); reset(); }} autoComplete="off" /></label>
      <label className="min-w-0 text-sm">Tình huống<select className={field} value={scenario} disabled={busy} onChange={event => { setScenario(event.target.value); reset(); }}><option value="success">Gọi API bình thường</option><option value="missing">Thiếu API key</option><option value="upstream">Backend đích bị lỗi</option></select></label>
      <div className="flex items-end"><button disabled={!selected || busy} className="btn-primary w-full justify-center sm:w-auto">{busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Send aria-hidden className="size-4" />}Gửi request mô phỏng</button></div>
    </form>
    <pre className="overflow-x-auto whitespace-pre rounded-md border border-line bg-page p-3 text-xs"><code>GET https://gateway.demo.example/proxy/{selected || '<API ID>'}{pathFor(selected)}</code></pre>
    {busy && <p role="status" className="flex items-center gap-2 text-sm text-ink2"><Loader2 aria-hidden className="size-4 animate-spin" />Đang gửi request mô phỏng…</p>}
    {error && <p role="alert" className="rounded-xl border border-critical bg-critical/10 p-3 text-sm text-critical">{error}</p>}
    {animation && <RequestSimulator key={run} initial={animation} autoPlay locked />}
    {result && <div className="space-y-3" role="status">
      <p className={`inline-flex items-center gap-2 rounded-md px-2.5 py-1 text-sm font-semibold ${result.status === 200 ? 'bg-good/15 text-good' : 'bg-critical/15 text-critical'}`}>HTTP {result.status} · Kết quả mô phỏng</p>
      <ol className="list-decimal space-y-1 pl-5 text-sm">{result.steps.map(step => <li key={step}>{step}</li>)}</ol>
      <pre className="max-h-80 overflow-auto rounded-md border border-line bg-page p-3 text-xs"><code>{JSON.stringify(result.body, null, 2)}</code></pre>
      <p className="text-xs text-muted">Request thành công được cộng vào tổng lượt gọi demo. Không phải bằng chứng gateway thật đã hoạt động.</p>
    </div>}
  </Card>;
}
