import { createContext, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useSettings } from '../app/settings';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, EmptyState, HealthBadge, PageHeader, QueryBoundary, Tag } from '../components/ui';
import type { Health } from '../domain/status';
import { portalCall, PortalError, readToken, saveToken } from '../portal/client';
import { createDemoClient } from '../portal/demo';
import { IntegrationGuide } from '../portal/IntegrationGuide';
import { DemoRequest } from '../portal/DemoRequest';

type Account = { orgName: string; email: string; tenantId: string; role?: 'admin' };
type Api = { apiId: string; name: string; baseUrl: string; timeoutMs: number; enabled: boolean };
type Key = { keyId: string; name: string; status: string; apiIds?: string[]; createdAt: string };
type Counts = { requests: number; errors: number };
type Usage = { totals: Counts & { totalMs: number }; byRegion: Record<string, Counts>; byKey: Record<string, Counts>; series: (Counts & { bucket: string; servedRegion: string })[] };
type Tab = 'overview' | 'apis' | 'keys' | 'guide' | 'request';
const tabs: [Tab, string][] = [['overview', 'Tổng quan'], ['apis', 'API đích'], ['keys', 'API key'], ['guide', 'Hướng dẫn']];
const ADMIN_SAMPLE_PREFIX = 'API Todo demo';
const button = 'portal-btn';
const primary = 'btn-primary min-h-10 disabled:cursor-not-allowed';
const input = 'portal-input';
const label = 'portal-label';
const tabClass = (active: boolean) => `shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors ${active ? 'bg-accent font-semibold text-on-accent' : 'text-ink2 hover:bg-raised hover:text-ink'}`;
const message = (error: unknown) => error instanceof Error ? error.message : 'Có lỗi xảy ra.';
const PortalClient = createContext<typeof portalCall>(portalCall);

function Alert({ children }: { children: ReactNode }) {
  return <p role="alert" className="portal-alert">{children}</p>;
}

// Bản thu gọn của QueryBoundary cho các khối nhỏ: khung tải một dòng thay vì skeleton cả dashboard.
function Inline<T>({ query, children, lines = 1 }: { query: { data: T | undefined; isPending: boolean; error: unknown; refetch: () => unknown }; children: (data: T) => ReactNode; lines?: number }) {
  if (query.data === undefined && !query.error) return <div role="status" className="space-y-2"><span className="sr-only">Đang tải dữ liệu…</span>{Array.from({ length: lines }, (_, i) => <div key={i} className="h-5 animate-pulse rounded bg-raised" />)}</div>;
  return <QueryBoundary query={query}>{children}</QueryBoundary>;
}

const health = (status: string): Health => {
  const value = status.toLowerCase();
  return value.startsWith('healthy') ? 'healthy' : value.startsWith('degraded') ? 'degraded' : value.startsWith('down') || value.startsWith('unhealthy') ? 'down' : 'unknown';
};

export function PortalPage() {
  const [demo, setDemo] = useState(false);
  const { update: updateSettings } = useSettings();
  const queryClient = useQueryClient();
  const client = useMemo(() => demo ? createDemoClient() : portalCall, [demo]);
  return <PortalClient.Provider value={client}><div className="space-y-4">
    <Card className="hero-card flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0 flex-1"><p className="font-semibold">{demo ? 'DEMO PORTAL · Dữ liệu mô phỏng' : 'Khám phá luồng tích hợp'}</p><p className="mt-1 text-sm text-ink2">{demo ? 'Mọi thao tác chỉ chạy trong bộ nhớ trình duyệt. Thoát demo sẽ bỏ dữ liệu mẫu; không gọi AWS.' : 'Thử quản lý API, lấy key và gửi request mẫu mà không cần đăng ký tài khoản.'}</p></div><button type="button" className={`${demo ? button : primary} shrink-0 justify-center`} onClick={() => {
      queryClient.removeQueries({ predicate: query => query.queryKey[0] === 'portal' && String(query.queryKey[1]).startsWith('demo:') });
      // Demo portal mở luôn các trang báo cáo bằng dữ liệu mẫu; thoát demo thì về dữ liệu thật.
      updateSettings({ demoMode: !demo });
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
    client.removeQueries({ predicate: query => query.queryKey[0] === 'http' || query.queryKey[0] === 'report-access' });
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
        <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><h2 className="break-words font-semibold">{user.orgName}</h2>{user.role === 'admin' && <Tag tone="accent">Admin</Tag>}</div>
            <p className="break-all text-sm text-ink2">{user.email}</p>
          </div>
          {demo ? <span className="max-w-full [&>span]:whitespace-normal"><Tag tone="warning">Tài khoản mẫu · Không dùng trên AWS</Tag></span> : <Logout token={token} onLogout={() => session(null)} />}
        </Card>
        <nav aria-label="Chức năng doanh nghiệp" className="portal-tabs flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-1">
          {tabs.map(([id, label]) => <button type="button" key={id} aria-pressed={tab === id} onClick={event => { setTab(id); event.currentTarget.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }} className={tabClass(tab === id)}>{label}</button>)}
          {demo && <button type="button" className={tabClass(tab === 'request')} aria-pressed={tab === 'request'} onClick={event => { setTab('request'); event.currentTarget.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }}>Thử request demo</button>}
        </nav>
        <PortalContent key={token} token={token} tab={tab} admin={user.role === 'admin'} onTab={setTab} onExpired={() => session(null)} />
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
  return <Card className="w-full max-w-lg">
    <h2 className="mb-4 font-semibold">{signup ? 'Đăng ký doanh nghiệp' : 'Đăng nhập'}</h2>
    <form onSubmit={submit} className="space-y-4">
      {signup && <label className={label}>Tên doanh nghiệp<input className={input} name="orgName" maxLength={100} required autoComplete="organization" /></label>}
      <label className={label}>Email<input className={input} name="email" type="email" maxLength={200} required autoComplete="username" /></label>
      <label className={label}>Mật khẩu<input className={input} name="password" type="password" minLength={8} maxLength={200} required autoComplete={signup ? 'new-password' : 'current-password'} /></label>
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-col items-start gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
        <button className={`${primary} w-full justify-center sm:w-auto`} disabled={busy}>{busy ? 'Đang xử lý…' : signup ? 'Đăng ký' : 'Đăng nhập'}</button>
        <button type="button" disabled={busy} className="portal-link" onClick={() => { setSignup(!signup); setError(''); }}>{signup ? 'Đã có tài khoản? Đăng nhập' : 'Chưa có tài khoản? Đăng ký doanh nghiệp'}</button>
      </div>
    </form>
  </Card>;
}

function Logout({ token, onLogout }: { token: string; onLogout: () => void }) {
  const portalCall = useContext(PortalClient);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  return <div className="flex flex-col items-start gap-2 sm:items-end"><button className={button} disabled={busy} onClick={async () => {
    setBusy(true); setError('');
    try { await portalCall('logout', token, 'POST'); onLogout(); }
    catch (err) { if (err instanceof PortalError && err.status === 401) onLogout(); else setError(message(err)); }
    finally { setBusy(false); }
  }}>Đăng xuất</button>{error && <Alert>{error}</Alert>}</div>;
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return <Card className="min-w-0 !p-4 sm:!p-5"><p className="text-sm text-ink2">{label}</p><p className="mt-2 break-words text-xl font-semibold tabular-nums sm:text-2xl">{value}</p></Card>;
}

function Breakdown({ rows }: { rows: [string, Counts][] }) {
  if (!rows.length) return <p className="text-sm text-muted">Chưa có dữ liệu.</p>;
  return <ul className="divide-y divide-line text-sm">{rows.map(([name, counts]) => <li key={name} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
    <span className="min-w-0 break-all font-medium">{name}</span>
    <span className="tabular-nums text-ink2">{counts.requests.toLocaleString('vi-VN')} lượt gọi · {counts.errors.toLocaleString('vi-VN')} lỗi</span>
  </li>)}</ul>;
}

function AdminSampleCard({ apis, onGuide }: { apis: Api[]; onGuide: () => void }) {
  const samples = apis.filter(api => api.name.startsWith(ADMIN_SAMPLE_PREFIX));
  return <Card className="border-accent/40">
    <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">Project mẫu đã tích hợp sẵn</h2><Tag tone="accent">Admin</Tag></div>
    <p className="mt-2 text-sm text-ink2">Tài khoản admin đã có sẵn API <strong className="text-ink">"API Todo demo"</strong> (backend <code className="portal-code">https://jsonplaceholder.typicode.com</code>) và key <strong className="text-ink">"Project mẫu"</strong> để chạy project Go trong <code className="portal-code">project_test/</code> hoặc các project zip mẫu (Java, JavaScript, Python).</p>
    <p className="mt-2 text-sm text-ink2">Secret của key không bao giờ hiển thị lại — nó chỉ hiện một lần lúc tạo. Nếu không còn giữ secret, hãy tạo key mới ở tab API key cho các API dưới đây rồi đưa vào file <code className="portal-code">.env</code>.</p>
    <div className="mt-4">
      <p className="mb-2 text-sm font-medium">API mẫu của tài khoản</p>
      {samples.length ? <ul className="divide-y divide-line rounded-lg border border-line text-sm">{samples.map(api => <li key={api.apiId} className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <span className="font-medium">{api.name}{!api.enabled && <span className="ml-2 text-xs text-muted">(đã tắt)</span>}</span>
        <code className="portal-code break-all">{api.apiId}</code>
      </li>)}</ul> : <p className="text-sm text-muted">Chưa thấy API nào có tên bắt đầu bằng "{ADMIN_SAMPLE_PREFIX}".</p>}
    </div>
    <button type="button" className={`${primary} mt-4`} onClick={onGuide}>Mở hướng dẫn tích hợp</button>
  </Card>;
}

function PortalContent({ token, tab, admin = false, onTab, onExpired }: { token: string; tab: Tab; admin?: boolean; onTab: (tab: Tab) => void; onExpired: () => void }) {
  const portalCall = useContext(PortalClient);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Api | null>(null);
  const [secret, setSecret] = useState(''); const [copied, setCopied] = useState(false);
  const [range, setRange] = useState('24h'); const [keyFilter, setKeyFilter] = useState('all'); const client = useQueryClient();
  const { update: updateSettings } = useSettings();
  const queryKey = ['portal', token];
  const apiQuery = useQuery({ queryKey: [...queryKey, 'apis'], enabled: tab === 'apis' || tab === 'request' || tab === 'keys' || (admin && tab === 'overview'), retry: false, queryFn: ({ signal }) => portalCall<{ apis: Api[] }>('apis', token, 'GET', undefined, signal) });
  const keysQuery = useQuery({ queryKey: [...queryKey, 'keys'], enabled: tab === 'keys' || tab === 'overview', retry: false, queryFn: ({ signal }) => portalCall<{ keys: Key[] }>('keys', token, 'GET', undefined, signal) });
  // Tự tải lại mỗi 15 giây khi đang mở Tổng quan, để request vừa gửi hiện ra mà không phải bấm Làm mới.
  const usageQuery = useQuery({ queryKey: [...queryKey, 'usage', range, keyFilter], enabled: tab === 'overview', retry: false, refetchInterval: 15_000, queryFn: ({ signal }) => portalCall<Usage>(`usage?range=${range}&keyId=${encodeURIComponent(keyFilter)}`, token, 'GET', undefined, signal) });
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
    {error && <Alert>{error}</Alert>}
    {tab === 'apis' && <>
      <Card><h2 className="mb-2 font-semibold">{editing ? 'Chỉnh sửa API đích' : 'Đăng ký API đích'}</h2>
        <p className="mb-4 text-sm text-ink2">Khai báo backend HTTPS. Gateway chuyển tiếp request tới backend này qua đường dẫn /proxy/API_ID, dùng API key có phạm vi tương ứng.</p>
        <form key={editing?.apiId ?? 'new'} className="grid gap-4 sm:grid-cols-2" onSubmit={event => {
          event.preventDefault(); const form = event.currentTarget; const values = new FormData(form);
          void mutate(async () => {
            await portalCall(`apis${editing ? `/${editing.apiId}` : ''}`, token, editing ? 'PATCH' : 'POST', { name: values.get('name'), baseUrl: values.get('baseUrl'), timeoutMs: Number(values.get('timeoutMs')) });
            form.reset(); setEditing(null);
          });
        }}>
          <label className={label}>Tên API<input className={input} name="name" defaultValue={editing?.name} maxLength={100} required /></label>
          <label className={label}>URL backend<input className={input} name="baseUrl" type="url" defaultValue={editing?.baseUrl} placeholder="https://backend.company.com/v1" required /></label>
          <label className={label}>Timeout (ms)<input className={input} name="timeoutMs" type="number" inputMode="numeric" defaultValue={editing?.timeoutMs ?? 5000} min={1000} max={10000} step={1} required /></label>
          <div className="flex flex-wrap items-end gap-2"><button className={primary} disabled={busy}>{editing ? 'Lưu thay đổi' : 'Đăng ký API'}</button>{editing && <button type="button" className={button} disabled={busy} onClick={() => setEditing(null)}>Hủy chỉnh sửa</button>}</div>
        </form>
      </Card>
      <QueryBoundary query={apiQuery}>{({ apis }) => <div className="space-y-3">{!apis.length && <EmptyState title="Chưa đăng ký API nào.">Điền form ở trên để thêm backend đầu tiên.</EmptyState>}{apis.map(api => <Card key={api.apiId}>
        <div className="flex flex-wrap items-center gap-2"><h3 className="min-w-0 break-words font-semibold">{api.name}</h3><Tag tone={api.enabled ? 'accent' : 'neutral'}>{api.enabled ? 'Đang bật' : 'Đã tắt'}</Tag></div>
        <p className="my-2 break-all text-sm text-ink2">{api.baseUrl} · {api.timeoutMs} ms</p><p className="mb-3 break-all font-mono text-xs text-muted">ID: {api.apiId}</p>
        <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => setEditing(api)}>Chỉnh sửa</button><button className={button} disabled={busy} onClick={() => void mutate(async () => { await portalCall(`apis/${api.apiId}`, token, 'PATCH', { enabled: !api.enabled }); })}>{api.enabled ? 'Vô hiệu hóa' : 'Bật API'}</button></div>
      </Card>)}</div>}</QueryBoundary>
    </>}
    {tab === 'keys' && <Card>
      <h2 className="mb-2 font-semibold">API key</h2><p className="mb-4 text-sm text-ink2">Dùng một key cho mỗi ứng dụng để có thể thu hồi độc lập. Key chỉ gọi được các API được chọn khi tạo; muốn đổi phạm vi thì tạo key mới.</p>
      <form className="space-y-4" onSubmit={event => {
        event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); const apiIds = values.getAll('apiIds');
        if (!apiIds.length) { setError('Chọn ít nhất một API mà key được phép gọi'); return; }
        void mutate(async () => { setSecret(''); setCopied(false); const result = await portalCall<{ apiKey: string }>('keys', token, 'POST', { name: values.get('name'), apiIds }); setSecret(result.apiKey); form.reset(); });
      }}><label className={`${label} max-w-md`}>Tên ứng dụng<input className={input} name="name" maxLength={60} required /></label>
        <Inline query={apiQuery}>{({ apis }) => <fieldset className="min-w-0 text-sm"><legend className="mb-2 font-medium text-ink2">API được phép gọi</legend>{!apis.length && <p className="text-muted">Đăng ký API đích trước khi tạo key.</p>}<div className="flex flex-wrap gap-2">{apis.map(api => <label key={api.apiId} className="portal-check"><input type="checkbox" name="apiIds" value={api.apiId} />{api.name}</label>)}</div></fieldset>}</Inline>
        <button className={primary} disabled={busy}>Tạo key</button></form>
      {secret && <div className="my-4 space-y-3 rounded-lg border border-good bg-good/10 p-3"><p className="text-sm font-semibold">Sao chép ngay — key chỉ hiển thị một lần.</p><code className="portal-code block break-all p-2 text-sm">{secret}</code><div className="flex flex-wrap gap-2"><button className={button} onClick={async () => { try { await navigator.clipboard.writeText(secret); setCopied(true); } catch { setError('Không sao chép tự động được. Hãy sao chép key ở trên.'); } }}>{copied ? 'Đã sao chép' : 'Sao chép'}</button><button className={button} onClick={() => setSecret('')}>Ẩn key</button></div></div>}
      <Inline query={keysQuery} lines={2}>{({ keys }) => <div className="mt-4 space-y-3">{!keys.length && <p className="text-sm text-muted">Chưa có key nào.</p>}{keys.map(key => <div key={key.keyId} className="flex flex-col gap-3 border-t border-line pt-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className={`text-sm font-semibold ${key.status === 'active' ? '' : 'text-muted'}`}>{key.name} · {key.status === 'active' ? 'Đang dùng' : 'Đã thu hồi'}</p><p className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted"><span className="break-all font-mono">{key.keyId}</span><span aria-hidden>·</span><span>{new Date(key.createdAt).toLocaleString('vi-VN')}</span><span aria-hidden>·</span><span className="break-words">{key.apiIds?.length ? `API: ${key.apiIds.map(id => apiQuery.data?.apis.find(api => api.apiId === id)?.name ?? id).join(', ')}` : 'Chưa có phạm vi API (key cũ, không gọi được proxy)'}</span></p></div>{key.status === 'active' && <button className={`${button} self-start sm:self-center`} disabled={busy} onClick={() => { if (window.confirm(`Thu hồi key của ${key.name}? Ứng dụng dùng key này sẽ mất quyền truy cập.`)) void mutate(async () => { await portalCall(`keys/${key.keyId}`, token, 'DELETE'); setSecret(''); }); }}>Thu hồi</button>}</div>)}</div>}</Inline>
    </Card>}
    {tab === 'overview' && <>
      {admin && <Inline query={apiQuery} lines={3}>{({ apis }) => <AdminSampleCard apis={apis} onGuide={() => onTab('guide')} />}</Inline>}
      <div className="flex flex-wrap items-end gap-3"><label className={label}>Khoảng thời gian<select className={`${input} sm:w-44`} value={range} onChange={event => setRange(event.target.value)}><option value="1h">1 giờ</option><option value="24h">24 giờ</option><option value="7d">7 ngày</option></select></label><label className={label}>API key<select className={`${input} sm:w-56`} value={keyFilter} onChange={event => setKeyFilter(event.target.value)}><option value="all">Tất cả API key</option>{keysQuery.data?.keys.map(key => <option key={key.keyId} value={key.keyId}>{key.name}{key.status === 'active' ? '' : ' (đã thu hồi)'}</option>)}</select></label><button className={button} onClick={() => void client.invalidateQueries({ queryKey })}>Làm mới</button>{!token.startsWith('demo:') && <Link className="portal-link self-center text-sm" to="/" onClick={() => updateSettings({ keyId: keyFilter })}>Xem báo cáo chi tiết{keyFilter === 'all' ? '' : ' của key này'} →</Link>}</div>
      <QueryBoundary query={usageQuery}>{usage => <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[['Tổng lượt gọi', usage.totals.requests.toLocaleString('vi-VN')], ['Lượt lỗi', usage.totals.errors.toLocaleString('vi-VN')], ['Thời gian xử lý trung bình', usage.totals.requests ? `${(usage.totals.totalMs / usage.totals.requests).toFixed(1)} ms` : 'Chưa có dữ liệu']].map(([label, value]) => <Stat key={label} label={label} value={value} />)}
          <Stat label="Key đang dùng" value={<Inline query={keysQuery}>{({ keys }) => keys.filter(key => key.status === 'active').length}</Inline>} />
        </div>
        <Card><h2 className="mb-3 font-semibold">Lượt gọi theo thời gian</h2>{!usage.series.length ? <p className="text-sm text-muted">Chưa có lượt gọi nào qua proxy trong khoảng thời gian này.</p> : <UsageChart series={usage.series} />}</Card>
        <div className="grid gap-3 md:grid-cols-2"><Card><h2 className="mb-3 font-semibold">Theo region</h2><Breakdown rows={Object.entries(usage.byRegion)} /></Card>
        <Card><h2 className="mb-3 font-semibold">Theo API key</h2>{keyFilter !== 'all' && <p className="mb-2 text-xs text-muted">Đang lọc một key. Chọn "Tất cả API key" để so sánh các key.</p>}<Breakdown rows={Object.entries(usage.byKey).map(([id, counts]) => [keysQuery.data?.keys.find(key => key.keyId === id)?.name ?? id, counts])} /></Card></div>
      </>}</QueryBoundary>
      <Card><h2 className="mb-3 font-semibold">Trạng thái region</h2><Inline query={statusQuery} lines={2}>{({ regions }) => regions.length ? <ul className="divide-y divide-line text-sm">{regions.map(region => <li key={region.region} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0"><span className="font-medium">{region.region}</span><HealthBadge health={health(region.status)} label={region.status} /></li>)}</ul> : <p className="text-sm text-muted">Chưa có trạng thái health check.</p>}</Inline></Card>
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
  const tick = { fontSize: 11, fill: 'var(--muted)' };
  const bucketLabel = (value: unknown) => {
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  };
  return <div className="h-64" role="img" aria-label="Biểu đồ lượt gọi theo thời gian và region"><ResponsiveContainer width="100%" height="100%"><BarChart data={Object.values(buckets).sort((a, b) => String(a.bucket).localeCompare(String(b.bucket)))} margin={{ left: -16, right: 4 }}><CartesianGrid stroke="var(--grid)" vertical={false} /><XAxis dataKey="bucket" tick={tick} stroke="var(--axis)" minTickGap={24} tickFormatter={bucketLabel} /><YAxis allowDecimals={false} tick={tick} stroke="var(--axis)" /><Tooltip labelFormatter={bucketLabel} cursor={{ fill: 'var(--raised)' }} contentStyle={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--ink)' }} /><Legend wrapperStyle={{ fontSize: 12 }} />{regions.map((region, index) => <Bar key={region} dataKey={region} stackId="requests" fill={index % 2 ? 'var(--series-2)' : 'var(--series-1)'} />)}</BarChart></ResponsiveContainer></div>;
}
