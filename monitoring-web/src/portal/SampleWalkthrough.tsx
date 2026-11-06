import { ArrowLeft, ArrowRight, Check, ClipboardPaste, Download, KeyRound, Play, Plus, RotateCcw } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Card, Tag } from '../components/ui';
import { ENDPOINTS } from '../data/deployment';
import { Snippet } from './Snippet';

// Giá trị mẫu; client Go từ chối key DEMO_ONLY nên không dùng nhầm được trên gateway thật.
const SAMPLE_URL = 'https://ten-ngau-nhien.trycloudflare.com';
const SAMPLE_API_ID = 'API_ID_MAU';
const SAMPLE_KEY = 'DEMO_ONLY_KEY_MAU_KHONG_GOI_DUOC_GATEWAY';

const STEPS: [string, string][] = [['Chạy backend', 'Có một API để gọi'], ['Đăng ký API đích', 'Lấy API ID'], ['Tạo API key', 'Sao chép một lần'], ['Dán vào .env', 'Giữ key ở server'], ['Chạy và xem kết quả', 'Gọi qua gateway']];

type Outcome = { id: string; label: string; lines: string; ok: boolean; counted: boolean; measured: boolean; note: string };

// Dòng HTTP và body theo định dạng in của project_test/main.go.
const OUTCOMES: Outcome[] = [
  { id: 'ok', label: 'Key đúng', ok: true, counted: true, measured: false, note: 'Backend trả dữ liệu, gateway chuyển nguyên về client và ghi một dòng telemetry.',
    lines: 'HTTP 200 | 420 ms | region: ap-southeast-1\n{"orders":[{"currency":"VND","id":"TEST-001","total":250000}],"source":"project_test"}' },
  { id: 'wrong', label: 'Dán sai key', ok: false, counted: false, measured: true, note: 'Bị chặn trước proxy nên backend không nhận được gì và Tổng quan không tăng.',
    lines: 'HTTP 401 | 180 ms | region: \n{"message":"Unauthorized"}\nLỗi: gateway trả HTTP 401' },
  { id: 'revoked', label: 'Key đã thu hồi', ok: false, counted: false, measured: false, note: 'Authorizer từ chối. Mã KEY_REVOKED nằm trong log authorizer, không nằm trong response.',
    lines: 'HTTP 403 | 190 ms | region: \n{"Message":"User is not authorized to access this resource"}\nLỗi: gateway trả HTTP 403' },
  { id: 'down', label: 'Backend đã tắt', ok: false, counted: true, measured: true, note: 'Key vẫn đúng, lỗi nằm ở backend hoặc tunnel. Request vào tới proxy nên được tính là một lượt lỗi.',
    lines: 'HTTP 502 | 2329 ms | region: ap-southeast-1\n{"region":"ap-southeast-1","error":"Không kết nối được tới backend","code":"UPSTREAM_UNREACHABLE","requestId":"246ab711-f5ce-4b2a-a21d-242b71f9dba8"}\nLỗi: gateway trả HTTP 502' },
];

function Browser({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-xl border border-line bg-surface">
    <div className="code-bar"><span className="code-dots" aria-hidden><i /><i /><i /></span><span className="truncate rounded-md bg-white/10 px-2 py-0.5 text-xs">{ENDPOINTS.app.replace('https://', '')}/portal</span></div>
    <div className="space-y-3 p-4">{children}</div>
  </div>;
}

function Terminal({ title, children }: { title: string; children: ReactNode }) {
  return <div className="code-window"><div className="code-bar"><span className="code-dots" aria-hidden><i /><i /><i /></span><span className="truncate">{title}</span></div><pre className="min-h-40 whitespace-pre-wrap break-all p-3 text-xs leading-6"><code>{children}</code></pre></div>;
}

const Field = ({ label, value, marked }: { label: string; value: string; marked?: boolean }) => <div className="text-sm"><span className="text-ink2">{label}</span><span className={`mt-1 block break-all rounded-md border px-3 py-2 ${marked ? 'border-accent bg-accent/10 font-semibold text-ink' : 'border-line bg-raised text-ink2'}`}>{value}</span></div>;

const envLine = (name: string, value: string, marked: boolean) => <span className={`block whitespace-pre-wrap break-all rounded px-1 ${marked ? 'bg-good/20' : ''}`}>{name}={value}</span>;

export function SampleWalkthrough() {
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [totals, setTotals] = useState({ requests: 0, errors: 0 });
  const complete = () => setDone(value => Math.max(value, step + 1));
  const finished = done > step;
  const reset = () => { setStep(0); setDone(0); setOutcome(null); setTotals({ requests: 0, errors: 0 }); };
  const run = (next: Outcome) => {
    setOutcome(next); complete();
    if (next.counted) setTotals(value => ({ requests: value.requests + 1, errors: value.errors + (next.ok ? 0 : 1) }));
  };

  const screens = [
    <Terminal key="backend" title="PowerShell · thư mục project mẫu">{'> go run ./server\n'}{finished ? <>{'Test backend: http://127.0.0.1:8080/orders\n\n> cloudflared tunnel --url http://127.0.0.1:8080\n'}<span className="font-bold text-good">{SAMPLE_URL}</span></> : ''}</Terminal>,
    <Browser key="api"><p className="text-sm font-semibold text-ink">Tab API đích</p><div className="grid gap-3 sm:grid-cols-2"><Field label="Tên API" value="API đơn hàng mẫu" /><Field label="URL backend" value={SAMPLE_URL} marked={!finished} /></div>{finished && <div className="rounded-lg border border-good bg-good/10 p-3 text-sm"><p className="font-semibold text-ink">API đơn hàng mẫu · Đang bật</p><p className="mt-1 text-ink2">ID: <strong className="text-ink">{SAMPLE_API_ID}</strong> ← sao chép giá trị này</p></div>}</Browser>,
    <Browser key="key"><p className="text-sm font-semibold text-ink">Tab API key</p><Field label="Tên ứng dụng" value="Project mẫu" /><p className="flex items-center gap-2 text-sm text-ink2"><span className="grid size-4 place-items-center rounded bg-accent text-on-accent"><Check aria-hidden className="size-3" /></span>API đơn hàng mẫu</p>{finished && <div className="rounded-lg border border-good p-3"><p className="text-sm font-semibold text-ink">Sao chép ngay — key chỉ hiển thị một lần.</p><code className="mt-1 block break-all text-sm">{SAMPLE_KEY}</code></div>}</Browser>,
    <Terminal key="env" title=".env · cùng thư mục với main.go">{envLine('MRAPI_GATEWAY_URL', ENDPOINTS.api, false)}{envLine('MRAPI_API_ID', finished ? SAMPLE_API_ID : 'YOUR_REGISTERED_API_ID', finished)}{envLine('MRAPI_API_KEY', finished ? SAMPLE_KEY : 'PASTE_YOUR_SECRET_KEY_HERE', finished)}</Terminal>,
    <div key="run" className="space-y-3"><Terminal title="PowerShell · thư mục project mẫu">{'> go run . /orders\n'}{outcome ? <span className={outcome.ok ? 'text-good' : ''}>{outcome.lines}</span> : ''}</Terminal>
      <div className="grid gap-2 sm:grid-cols-2"><div className="rounded-xl bg-raised p-3"><p className="text-xs text-ink2">Tổng quan · Tổng lượt gọi</p><p className="mt-1 text-xl font-semibold tabular-nums">{totals.requests}</p></div><div className="rounded-xl bg-raised p-3"><p className="text-xs text-ink2">Tổng quan · Lượt lỗi</p><p className="mt-1 text-xl font-semibold tabular-nums">{totals.errors}</p></div></div></div>,
  ];

  const guide = [
    { text: 'Project mẫu gồm một API đơn hàng (server) và một client. Gateway chỉ gọi backend HTTPS công khai, nên backend ở máy cần một tunnel. Tunnel chỉ dùng để thử.', code: 'go run ./server\ncloudflared tunnel --url http://127.0.0.1:8080', title: 'Hai terminal, mỗi lệnh một terminal', action: 'Chạy backend' },
    { text: 'Vào tab API đích, dán URL HTTPS vừa có vào URL backend, không thêm /orders. Bấm Đăng ký API rồi sao chép API ID.', action: 'Đăng ký API' },
    { text: 'Vào tab API key, đặt tên ứng dụng, tích đúng API vừa đăng ký rồi bấm Tạo key. Sao chép ngay, vì key chỉ hiện một lần. Key thật bắt đầu bằng mrk_.', action: 'Tạo key' },
    { text: 'Tạo file .env từ .env.example rồi dán API ID và key vào hai dòng được tô màu. File này chỉ nằm trên server, không commit và không đưa vào frontend.', code: 'Copy-Item .env.example .env', title: 'Tạo file .env', action: 'Dán API ID và key' },
    { text: 'Chạy client rồi mở tab Tổng quan trên portal. Bấm từng tình huống để xem terminal in gì và số liệu có tăng không.', code: 'go run . /orders', title: 'Gọi API qua gateway' },
  ][step];

  return <section id="guide-sample" className="scroll-mt-20"><Card className="space-y-4">
    <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">Làm thử với project mẫu</h2><Tag tone="warning">Mô phỏng, không gọi AWS</Tag></div>
    <p className="text-sm text-ink2">Bấm qua năm bước để thấy API key đi từ portal vào code. Muốn làm thật, tải project Go mẫu và chạy đúng các lệnh ở từng bước (cần Go 1.22 trở lên).</p>
    <a className="chip w-fit" href="/samples/project-mau-mrapi.zip" download><Download aria-hidden className="size-4" />Tải project mẫu (.zip)</a>

    <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">{STEPS.map(([title, hint], index) => {
      const passed = done > index;
      return <li key={title}><button type="button" aria-label={`Bước ${index + 1}: ${title}`} aria-current={step === index ? 'step' : undefined} disabled={index > done} onClick={() => setStep(index)} className={`flex h-full w-full items-center gap-2 rounded-xl border p-2 text-left transition disabled:opacity-50 ${step === index ? 'border-accent bg-accent/10' : 'border-line bg-surface'}`}>
        <span className={`grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${passed ? 'bg-good text-white' : 'bg-accent text-on-accent'}`}>{passed ? <Check aria-hidden className="size-3.5" /> : index + 1}</span>
        <span className="min-w-0"><span className="block text-xs font-semibold text-ink">{title}</span><span className="block text-xs text-muted">{hint}</span></span>
      </button></li>;
    })}</ol>

    <div className="grid gap-4 lg:grid-cols-2">
      <div className="min-w-0 space-y-3">
        <p aria-live="polite" className="rounded-xl bg-raised p-4 text-sm text-ink2"><strong className="block text-ink">Bước {step + 1}/5: {STEPS[step][0]}</strong>{guide.text}</p>
        {guide.code && <Snippet title={guide.title} code={guide.code} />}
      </div>
      <div className="min-w-0 space-y-3">
        {screens[step]}
        {guide.action && !finished && <button type="button" className="btn-primary" onClick={complete}>{[<Play key="p" aria-hidden className="size-4" />, <Plus key="a" aria-hidden className="size-4" />, <KeyRound key="k" aria-hidden className="size-4" />, <ClipboardPaste key="e" aria-hidden className="size-4" />][step]}{guide.action}</button>}
        {step === 4 && <div className="flex flex-wrap gap-2" role="group" aria-label="Chọn tình huống chạy client">{OUTCOMES.map(item => <button type="button" key={item.id} aria-pressed={outcome?.id === item.id} onClick={() => run(item)} className={`chip ${outcome?.id === item.id ? 'chip-active' : ''}`}>{item.label}</button>)}</div>}
        {outcome && step === 4 && <p role="status" className={`rounded-xl border p-3 text-sm ${outcome.ok ? 'border-good bg-good/10' : 'border-critical bg-critical/10'}`}>{outcome.note} <span className="text-ink2">{outcome.measured ? 'Đầu ra đo trên gateway thật ngày 02/11/2026.' : 'Đầu ra minh họa.'}</span></p>}
      </div>
    </div>

    <div className="flex flex-wrap gap-2">
      <button type="button" className="chip" disabled={step === 0} onClick={() => setStep(step - 1)}><ArrowLeft aria-hidden className="size-4" />Bước trước</button>
      {step < 4 && <button type="button" className="chip" disabled={!finished} onClick={() => setStep(step + 1)}>Bước tiếp<ArrowRight aria-hidden className="size-4" /></button>}
      <button type="button" className="chip" disabled={!done} onClick={reset}><RotateCcw aria-hidden className="size-4" />Làm lại</button>
    </div>
  </Card></section>;
}
