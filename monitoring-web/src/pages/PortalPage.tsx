import { createContext, useContext, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, PageHeader, QueryBoundary, Tag } from '../components/ui';
import { portalCall, PortalError, readToken, saveToken } from '../portal/client';
import { createDemoClient } from '../portal/demo';
import { IntegrationGuide } from '../portal/IntegrationGuide';
import { DemoRequest } from '../portal/DemoRequest';

type Account = { orgName: string; email: string; tenantId: string };
type Api = { apiId: string; name: string; baseUrl: string; timeoutMs: number; enabled: boolean };
type Key = { keyId: string; name: string; status: string; apiIds?: string[]; createdAt: string };
type Counts = { requests: number; errors: number };
type Usage = { totals: Counts & { totalMs: number }; byRegion: Record<string, Counts>; byKey: Record<string, Counts>; series: (Counts & { bucket: string; servedRegion: string })[] };
type Tab = 'overview' | 'apis' | 'keys' | 'guide' | 'request';
const tabs: [Tab, string][] = [['overview', 'Tổng quan'], ['apis', 'API đích'], ['keys', 'API key'], ['guide', 'Hướng dẫn']];
const button = 'rounded-md border border-line bg-raised px-3 py-2 text-sm hover:bg-surface disabled:opacity-50';
const input = 'w-full rounded-md border border-line bg-surface px-3 py-2 text-sm';
const message = (error: unknown) => error instanceof Error ? error.message : 'Có lỗi xảy ra.';
const PortalClient = createContext<typeof portalCall>(portalCall);

export function PortalPage() {
  const [demo, setDemo] = useState(false);
  const queryClient = useQueryClient();
  const client = useMemo(() => demo ? createDemoClient() : portalCall, [demo]);
  return <PortalClient.Provider value={client}><div className="space-y-4">
    <Card className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold">{demo ? 'DEMO PORTAL · Dữ liệu mô phỏng' : 'Khám phá luồng tích hợp'}</p><p className="mt-1 text-sm text-ink2">{demo ? 'Mọi thao tác chỉ chạy trong bộ nhớ trình duyệt. Thoát demo sẽ bỏ dữ liệu mẫu; không gọi AWS.' : 'Thử quản lý API, lấy key và gửi request mẫu mà không cần đăng ký tài khoản.'}</p></div><button type="button" className={button} onClick={() => {
      queryClient.removeQueries({ predicate: query => query.queryKey[0] === 'portal' && String(query.queryKey[1]).startsWith('demo:') });
      setDemo(!demo);
    }}>{demo ? 'Thoát demo, dùng tài khoản thật' : 'Trải nghiệm demo'}</button></Card>
    <PortalSession key={demo ? 'demo' : 'live'} demo={demo} />
  </div></PortalClient.Provider>;
}

function PortalSession({ demo }: { demo: boolean }) {
  const portalCall = useContext(PortalClient);
  const [token, setToken] = useState(() => demo ? `demo:${crypto.randomUUID()}` : readToken());
  const [tab, setTab] = useState<Tab>('overview');
  const client = useQueryClient();
  function session(next: string | null) {
    if (!demo) saveToken(next);
    setToken(next);
    client.removeQueries({ queryKey: ['portal'] });
  }
  const account = useQuery({
    queryKey: ['portal', token, 'me'], enabled: !!token, retry: false,
    queryFn: ({ signal }) => portalCall<Account>('me', token, 'GET', undefined, signal),
  });
  useEffect(() => {
    if (account.error instanceof PortalError && account.error.status === 401) {
      if (!demo) saveToken(null); setToken(null); client.removeQueries({ queryKey: ['portal'] });
    }
  }, [account.error, client, demo]);
  return <div className="space-y-4">
    <PageHeader title="Cổng doanh nghiệp" description="Quản lý tài khoản, API đích và API key trong cùng nền tảng Multi-Region." />
    {!token ? <><Auth onLogin={next => { session(next); setTab('apis'); }} /><IntegrationGuide /></> :
      <QueryBoundary query={account}>{user => <>
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="font-semibold">{user.orgName}</h2><p className="text-sm text-ink2">{user.email}</p></div>
          {demo ? <Tag tone="warning">Tài khoản mẫu · Không dùng trên AWS</Tag> : <Logout token={token} onLogout={() => session(null)} />}
        </Card>
        <nav aria-label="Chức năng doanh nghiệp" className="flex flex-wrap gap-2">
          {tabs.map(([id, label]) => <button type="button" key={id} aria-pressed={tab === id} onClick={() => setTab(id)} className={`${button} ${tab === id ? 'font-semibold text-accent' : ''}`}>{label}</button>)}
          {demo && <button type="button" className={`${button} ${tab === 'request' ? 'font-semibold text-accent' : ''}`} aria-pressed={tab === 'request'} onClick={() => setTab('request')}>Thử request demo</button>}
        </nav>
        <PortalContent key={token} token={token} tab={tab} onExpired={() => session(null)} />
      </>}</QueryBoundary>}
  </div>;
}

function Auth({ onLogin }: { onLogin: (token: string) => void }) {
  const portalCall = useContext(PortalClient);
  const [signup, setSignup] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    setBusy(true); setError('');
    try {
      const result = await portalCall<{ token: string }>(signup ? 'signup' : 'login', null, 'POST', {
        email: data.get('email'), password: data.get('password'), ...(signup ? { orgName: data.get('orgName') } : {}),
      });
      form.reset(); onLogin(result.token);
    } catch (err) { setError(message(err)); } finally { setBusy(false); }
  }
  return <Card className="max-w-lg">
    <h2 className="mb-4 font-semibold">{signup ? 'Đăng ký doanh nghiệp' : 'Đăng nhập'}</h2>
    <form onSubmit={submit} className="space-y-4">
      {signup && <label className="block text-sm">Tên doanh nghiệp<input className={input} name="orgName" maxLength={100} required autoComplete="organization" /></label>}
      <label className="block text-sm">Email<input className={input} name="email" type="email" maxLength={200} required autoComplete="username" /></label>
      <label className="block text-sm">Mật khẩu<input className={input} name="password" type="password" minLength={8} maxLength={200} required autoComplete={signup ? 'new-password' : 'current-password'} /></label>
      {error && <p role="alert" className="text-sm text-critical">{error}</p>}
      <button className={button} disabled={busy}>{busy ? 'Đang xử lý…' : signup ? 'Đăng ký' : 'Đăng nhập'}</button>
      <button type="button" disabled={busy} className="block text-sm text-accent" onClick={() => { setSignup(!signup); setError(''); }}>{signup ? 'Đã có tài khoản? Đăng nhập' : 'Chưa có tài khoản? Đăng ký doanh nghiệp'}</button>
    </form>
  </Card>;
}

function Logout({ token, onLogout }: { token: string; onLogout: () => void }) {
  const portalCall = useContext(PortalClient);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  return <div><button className={button} disabled={busy} onClick={async () => {
    setBusy(true); setError('');
    try { await portalCall('logout', token, 'POST'); onLogout(); }
    catch (err) { if (err instanceof PortalError && err.status === 401) onLogout(); else setError(message(err)); }
    finally { setBusy(false); }
  }}>Đăng xuất</button>{error && <p role="alert" className="text-sm text-critical">{error}</p>}</div>;
}

function PortalContent({ token, tab, onExpired }: { token: string; tab: Tab; onExpired: () => void }) {
  const portalCall = useContext(PortalClient);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Api | null>(null);
  const [secret, setSecret] = useState(''); const [copied, setCopied] = useState(false);
  const [range, setRange] = useState('24h'); const client = useQueryClient();
  const queryKey = ['portal', token];
  const apiQuery = useQuery({ queryKey: [...queryKey, 'apis'], enabled: tab === 'apis' || tab === 'request' || tab === 'keys', retry: false, queryFn: ({ signal }) => portalCall<{ apis: Api[] }>('apis', token, 'GET', undefined, signal) });
  const keysQuery = useQuery({ queryKey: [...queryKey, 'keys'], enabled: tab === 'keys' || tab === 'overview', retry: false, queryFn: ({ signal }) => portalCall<{ keys: Key[] }>('keys', token, 'GET', undefined, signal) });
  const usageQuery = useQuery({ queryKey: [...queryKey, 'usage', range], enabled: tab === 'overview', retry: false, queryFn: ({ signal }) => portalCall<Usage>(`usage?range=${range}`, token, 'GET', undefined, signal) });
  const statusQuery = useQuery({ queryKey: [...queryKey, 'status'], enabled: tab === 'overview', retry: false, queryFn: ({ signal }) => portalCall<{ regions: { region: string; status: string }[] }>('status', token, 'GET', undefined, signal) });
  const queryError = [apiQuery.error, keysQuery.error, usageQuery.error, statusQuery.error].find(err => err instanceof PortalError && err.status === 401);
  useEffect(() => { if (queryError) onExpired(); }, [queryError, onExpired]);
  useEffect(() => { setError(''); setSecret(''); setCopied(false); }, [tab]);
  async function mutate(work: () => Promise<void>) {
    setBusy(true); setError('');
    try { await work(); await client.invalidateQueries({ queryKey }); }
    catch (err) { if (err instanceof PortalError && err.status === 401) onExpired(); else setError(message(err)); }
    finally { setBusy(false); }
  }
  return <div className="space-y-4">
    {error && <p role="alert" className="text-sm text-critical">{error}</p>}
    {tab === 'apis' && <>
      <Card><h2 className="mb-2 font-semibold">{editing ? 'Chỉnh sửa API đích' : 'Đăng ký API đích'}</h2>
        <p className="mb-4 text-sm text-ink2">Khai báo backend HTTPS. Chức năng chuyển tiếp request chưa triển khai.</p>
        <form key={editing?.apiId ?? 'new'} className="grid gap-3 sm:grid-cols-2" onSubmit={event => {
          event.preventDefault(); const form = event.currentTarget; const values = new FormData(form);
          void mutate(async () => {
            await portalCall(`apis${editing ? `/${editing.apiId}` : ''}`, token, editing ? 'PATCH' : 'POST', { name: values.get('name'), baseUrl: values.get('baseUrl'), timeoutMs: Number(values.get('timeoutMs')) });
            form.reset(); setEditing(null);
          });
        }}>
          <label className="text-sm">Tên API<input className={input} name="name" defaultValue={editing?.name} maxLength={100} required /></label>
          <label className="text-sm">URL backend<input className={input} name="baseUrl" type="url" defaultValue={editing?.baseUrl} placeholder="https://backend.company.com/v1" required /></label>
          <label className="text-sm">Timeout (ms)<input className={input} name="timeoutMs" type="number" defaultValue={editing?.timeoutMs ?? 5000} min={1000} max={10000} step={1} required /></label>
          <div className="flex items-end gap-2"><button className={button} disabled={busy}>{editing ? 'Lưu thay đổi' : 'Đăng ký API'}</button>{editing && <button type="button" className={button} disabled={busy} onClick={() => setEditing(null)}>Hủy chỉnh sửa</button>}</div>
        </form>
      </Card>
      <QueryBoundary query={apiQuery}>{({ apis }) => <div className="space-y-3">{!apis.length && <Card>Chưa đăng ký API nào.</Card>}{apis.map(api => <Card key={api.apiId}>
        <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{api.name}</h3><Tag>{api.enabled ? 'Đang bật' : 'Đã tắt'}</Tag></div>
        <p className="my-2 break-all text-sm text-ink2">{api.baseUrl} · {api.timeoutMs} ms</p><p className="mb-3 break-all text-xs text-muted">ID: {api.apiId}</p>
        <div className="flex gap-2"><button className={button} disabled={busy} onClick={() => setEditing(api)}>Chỉnh sửa</button><button className={button} disabled={busy} onClick={() => void mutate(async () => { await portalCall(`apis/${api.apiId}`, token, 'PATCH', { enabled: !api.enabled }); })}>{api.enabled ? 'Vô hiệu hóa' : 'Bật API'}</button></div>
      </Card>)}</div>}</QueryBoundary>
    </>}
    {tab === 'keys' && <Card>
      <h2 className="mb-2 font-semibold">API key</h2><p className="mb-4 text-sm text-ink2">Dùng một key cho mỗi ứng dụng để có thể thu hồi độc lập. Key chỉ gọi được các API được chọn khi tạo; muốn đổi phạm vi thì tạo key mới.</p>
      <form className="space-y-3" onSubmit={event => {
        event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); const apiIds = values.getAll('apiIds');
        if (!apiIds.length) { setError('Chọn ít nhất một API mà key được phép gọi'); return; }
        void mutate(async () => { setSecret(''); setCopied(false); const result = await portalCall<{ apiKey: string }>('keys', token, 'POST', { name: values.get('name'), apiIds }); setSecret(result.apiKey); form.reset(); });
      }}><label className="block text-sm">Tên ứng dụng<input className={input} name="name" maxLength={60} required /></label>
        <QueryBoundary query={apiQuery}>{({ apis }) => <fieldset className="text-sm"><legend className="mb-1">API được phép gọi</legend>{!apis.length && <p className="text-muted">Đăng ký API đích trước khi tạo key.</p>}{apis.map(api => <label key={api.apiId} className="mr-4 inline-flex items-center gap-2"><input type="checkbox" name="apiIds" value={api.apiId} />{api.name}</label>)}</fieldset>}</QueryBoundary>
        <button className={button} disabled={busy}>Tạo key</button></form>
      {secret && <div className="my-4 space-y-2 rounded-md border border-good p-3"><p className="text-sm font-semibold">Sao chép ngay — key chỉ hiển thị một lần.</p><code className="block break-all text-sm">{secret}</code><button className={button} onClick={async () => { try { await navigator.clipboard.writeText(secret); setCopied(true); } catch { setError('Không sao chép tự động được. Hãy sao chép key ở trên.'); } }}>{copied ? 'Đã sao chép' : 'Sao chép'}</button><button className={`${button} ml-2`} onClick={() => setSecret('')}>Ẩn key</button></div>}
      <QueryBoundary query={keysQuery}>{({ keys }) => <div className="mt-4 space-y-3">{!keys.length && <p className="text-sm text-muted">Chưa có key nào.</p>}{keys.map(key => <div key={key.keyId} className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3"><div><p className="text-sm font-semibold">{key.name} · {key.status === 'active' ? 'Đang dùng' : 'Đã thu hồi'}</p><p className="text-xs text-muted">{key.keyId} · {new Date(key.createdAt).toLocaleString('vi-VN')} · {key.apiIds?.length ? `API: ${key.apiIds.map(id => apiQuery.data?.apis.find(api => api.apiId === id)?.name ?? id).join(', ')}` : 'Chưa có phạm vi API (key cũ, không gọi được proxy)'}</p></div>{key.status === 'active' && <button className={button} disabled={busy} onClick={() => { if (window.confirm(`Thu hồi key của ${key.name}? Ứng dụng dùng key này sẽ mất quyền truy cập.`)) void mutate(async () => { await portalCall(`keys/${key.keyId}`, token, 'DELETE'); setSecret(''); }); }}>Thu hồi</button>}</div>)}</div>}</QueryBoundary>
    </Card>}
    {tab === 'overview' && <>
      <div className="flex flex-wrap items-center gap-3"><label className="text-sm">Khoảng thời gian <select className={input} value={range} onChange={event => setRange(event.target.value)}><option value="1h">1 giờ</option><option value="24h">24 giờ</option><option value="7d">7 ngày</option></select></label><button className={button} onClick={() => void client.invalidateQueries({ queryKey })}>Làm mới</button></div>
      <QueryBoundary query={usageQuery}>{usage => <>
        <div className="grid gap-3 sm:grid-cols-3">{[['Tổng lượt gọi', usage.totals.requests.toLocaleString('vi-VN')], ['Lượt lỗi', usage.totals.errors.toLocaleString('vi-VN')], ['Thời gian xử lý trung bình', usage.totals.requests ? `${(usage.totals.totalMs / usage.totals.requests).toFixed(1)} ms` : 'Chưa có dữ liệu']].map(([label, value]) => <Card key={label}><p className="text-sm text-ink2">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p></Card>)}</div>
        <Card><h2 className="mb-3 font-semibold">Lượt gọi theo thời gian</h2>{!usage.series.length ? <p className="text-sm text-muted">Chưa có lượt gọi được ghi nhận. Proxy và telemetry chưa triển khai.</p> : <UsageChart series={usage.series} />}</Card>
        <div className="grid gap-3 sm:grid-cols-2"><Card><h2 className="mb-3 font-semibold">Theo region</h2>{Object.entries(usage.byRegion).map(([region, counts]) => <p className="text-sm" key={region}>{region}: {counts.requests} lượt gọi · {counts.errors} lỗi</p>)}{!Object.keys(usage.byRegion).length && <p className="text-sm text-muted">Chưa có dữ liệu.</p>}</Card>
        <Card><h2 className="mb-3 font-semibold">Theo API key</h2>{Object.entries(usage.byKey).map(([id, counts]) => <p className="text-sm" key={id}>{keysQuery.data?.keys.find(key => key.keyId === id)?.name ?? id}: {counts.requests} lượt gọi · {counts.errors} lỗi</p>)}{!Object.keys(usage.byKey).length && <p className="text-sm text-muted">Chưa có dữ liệu.</p>}</Card></div>
      </>}</QueryBoundary>
      <QueryBoundary query={keysQuery}>{({ keys }) => <Card>Key đang dùng: {keys.filter(key => key.status === 'active').length}</Card>}</QueryBoundary>
      <QueryBoundary query={statusQuery}>{({ regions }) => <Card><h2 className="mb-2 font-semibold">Trạng thái region</h2>{regions.length ? regions.map(region => <p key={region.region} className="text-sm">{region.region}: {region.status}</p>) : <p className="text-sm text-muted">Chưa có trạng thái health check.</p>}</Card>}</QueryBoundary>
    </>}
    {tab === 'guide' && <IntegrationGuide />}
    {tab === 'request' && <QueryBoundary query={apiQuery}>{({ apis }) => <DemoRequest call={portalCall} token={token} apis={apis} onSent={() => void client.invalidateQueries({ queryKey })} />}</QueryBoundary>}
  </div>;
}

function UsageChart({ series }: { series: Usage['series'] }) {
  const regions = [...new Set(series.map(point => point.servedRegion))].sort();
  const buckets: Record<string, Record<string, number | string>> = {};
  for (const point of series) {
    const row = buckets[point.bucket] ??= { bucket: point.bucket };
    row[point.servedRegion] = Number(row[point.servedRegion] ?? 0) + point.requests;
  }
  return <div className="h-64" role="img" aria-label="Biểu đồ lượt gọi theo thời gian và region"><ResponsiveContainer width="100%" height="100%"><BarChart data={Object.values(buckets).sort((a, b) => String(a.bucket).localeCompare(String(b.bucket)))}><CartesianGrid stroke="var(--grid)" vertical={false} /><XAxis dataKey="bucket" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} /><Tooltip contentStyle={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--ink)' }} /><Legend />{regions.map((region, index) => <Bar key={region} dataKey={region} stackId="requests" fill={index % 2 ? 'var(--series-2)' : 'var(--series-1)'} />)}</BarChart></ResponsiveContainer></div>;
}
