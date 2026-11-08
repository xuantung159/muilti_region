import { useState } from 'react';
import type { portalCall } from './client';
import { Card, Tag } from '../components/ui';
import { RequestSimulator } from './RequestSimulator';

type Result = { status: number; steps: string[]; body: unknown };
// Chọn hoạt cảnh theo status mà client demo trả về.
const simulationFor = (status: number, scenario: string) => status === 200 ? 'success' : status === 401 ? (scenario === 'missing' ? 'missing' : 'badkey') : status === 403 ? 'revoked' : status === 502 ? 'upstream' : null;

export function DemoRequest({ call, token, apis, onSent }: { call: typeof portalCall; token: string; apis: { apiId: string; name: string }[]; onSent: () => void }) {
  const [apiId, setApiId] = useState('');
  const [apiKey, setApiKey] = useState('DEMO_ONLY_SAMPLE_KEY');
  const [scenario, setScenario] = useState('success');
  const [result, setResult] = useState<Result | null>(null);
  const [run, setRun] = useState(0);
  const animation = result && simulationFor(result.status, scenario);
  const selected = apis.some(api => api.apiId === apiId) ? apiId : apis[0]?.apiId ?? '';
  const field = 'mt-1 w-full rounded border border-line bg-surface p-2 text-sm';
  return <Card className="space-y-4"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">Thử request demo</h2><Tag tone="warning">Mô phỏng trong trình duyệt</Tag></div>
    <p className="text-sm text-ink2">Dùng key mẫu có sẵn hoặc dán key DEMO_ONLY vừa tạo. Không gửi key thật vào đây. Request không gọi AWS hay backend đích.</p>
    <form className="grid gap-4 sm:grid-cols-2" onSubmit={async event => {
      event.preventDefault();
      const response = await call<Result>('demo/request', token, 'POST', { apiId: selected, apiKey: scenario === 'missing' ? '' : apiKey, upstreamError: scenario === 'upstream' });
      setResult(response); setRun(value => value + 1); onSent();
    }}>
      <label className="text-sm">API đích demo<select className={field} value={selected} onChange={event => { setApiId(event.target.value); setResult(null); }}>{apis.map(api => <option key={api.apiId} value={api.apiId}>{api.name}</option>)}</select></label>
      <label className="text-sm">API key demo<input className={field} value={apiKey} onChange={event => { setApiKey(event.target.value); setResult(null); }} autoComplete="off" /></label>
      <label className="text-sm">Tình huống<select className={field} value={scenario} onChange={event => { setScenario(event.target.value); setResult(null); }}><option value="success">Gọi API bình thường</option><option value="missing">Thiếu API key</option><option value="upstream">Backend đích bị lỗi</option></select></label>
      <div className="flex items-end"><button disabled={!selected} className="btn-primary">Gửi request mô phỏng</button></div>
    </form>
    <pre className="overflow-x-auto rounded bg-page p-3 text-xs">GET https://gateway.demo.example/proxy/{selected}/orders</pre>
    {animation && <RequestSimulator key={run} initial={animation} autoPlay locked />}
    {result && <div className="space-y-3" role="status"><p className="font-semibold">HTTP {result.status} · Kết quả mô phỏng</p><ol className="list-decimal space-y-1 pl-5 text-sm">{result.steps.map(step => <li key={step}>{step}</li>)}</ol><pre className="overflow-x-auto rounded border border-line bg-page p-3 text-xs">{JSON.stringify(result.body, null, 2)}</pre><p className="text-xs text-muted">Request thành công được cộng vào tổng lượt gọi demo. Không phải bằng chứng gateway thật đã hoạt động.</p></div>}
  </Card>;
}
