import { ArrowLeft, ArrowRight, CheckCircle2, Database, FastForward, Globe2, KeyRound, type LucideIcon, Network, Pause, Play, RotateCcw, Server, ShieldCheck, Shuffle, SkipForward, XCircle } from 'lucide-react';
import { type CSSProperties, useEffect, useState } from 'react';
import { Card, Tag } from '../components/ui';
import { ENDPOINTS } from '../data/deployment';

type FlowNode = { id: string; title: string; place: string; icon: LucideIcon; detail: string };

// Thứ tự theo docs/GATEWAY_DESIGN.md; chỉ mô tả luồng, không chứa số liệu.
const NODES: FlowNode[] = [
  { id: 'client', title: 'Server đối tác', place: 'Ngoài AWS', icon: Server, detail: 'Giữ API key trong biến môi trường và gửi request kèm header x-api-key. Trình duyệt hoặc app mobile không giữ key.' },
  { id: 'dns', title: 'Route 53', place: 'Toàn cục', icon: Globe2, detail: 'Trả địa chỉ của Region có độ trễ thấp với client và bỏ qua Region có health check lỗi. Đây là bước phân giải DNS; dữ liệu request không đi qua Route 53.' },
  { id: 'apigw', title: 'API Gateway', place: 'Trong Region', icon: Network, detail: 'REST API Regional nhận request tại /proxy/{apiId} và gọi authorizer trước khi cho vào proxy. Thiếu x-api-key bị trả 401 ngay tại đây.' },
  { id: 'authorizer', title: 'Lambda authorizer', place: 'Trong Region', icon: ShieldCheck, detail: 'Đọc key trong mrapi-control, kiểm tra trạng thái và phạm vi API. Key sai bị 401; key thu hồi hoặc ngoài phạm vi bị 403. Request bị từ chối ở đây không ghi telemetry.' },
  { id: 'proxy', title: 'Lambda proxy', place: 'Trong Region', icon: Shuffle, detail: 'Tra API theo tenant của key, chặn đích nội bộ, gỡ x-api-key, Authorization và cookie, rồi chuyển method, đường dẫn con, query và body tới backend.' },
  { id: 'backend', title: 'Backend đích', place: 'Của đối tác', icon: KeyRound, detail: 'Nhận request cùng header x-request-id. Status, header và body được trả nguyên về client với X-Mrapi-Source: upstream.' },
];
const [CLIENT, DNS, APIGW, AUTHORIZER, PROXY, BACKEND] = [0, 1, 2, 3, 4, 5];

type Step = { at: number; back?: boolean; fail?: boolean; packet: string; title: string; note: string; wire: string; data?: 'control' | 'telemetry' };
type Simulation = { id: string; label: string; region: 'sg' | 'tyo'; regionNote?: string; outcome: string; ok: boolean; steps: Step[] };

const REQUEST = `GET ${ENDPOINTS.api}/proxy/API_ID/orders`;
const send = (keyLine: string): Step => ({ at: CLIENT, packet: 'GET /orders', title: 'Server đối tác gửi request', note: 'Request xuất phát từ server của đối tác, không phải từ trình duyệt người dùng.', wire: `${REQUEST}\n${keyLine}` });
const resolve = (region: string, note: string): Step => ({ at: DNS, packet: 'DNS', title: `Route 53 chọn ${region}`, note, wire: `api.multi-region.io.vn → ${region}\nRouting: latency + health check` });
const LOW_LATENCY = 'Route 53 trả về Region có độ trễ thấp hơn với server này.';
const gateway = (keyLine = 'x-api-key: ••••••••'): Step => ({ at: APIGW, packet: 'GET /orders', title: 'API Gateway nhận request', note: 'Route /proxy/{apiId} yêu cầu authorizer, nên request chưa được vào proxy.', wire: `${REQUEST}\n${keyLine}` });
const authorized: Step = { at: AUTHORIZER, packet: 'Kiểm tra key', data: 'control', title: 'Authorizer xác thực key', note: 'Key hợp lệ, đang hoạt động và có quyền gọi API này. Tenant được chuyển tiếp cho proxy.', wire: 'Đọc mrapi-control\nstatus: active\nphạm vi: có API_ID' };
const proxied: Step = { at: PROXY, packet: 'Chuyển tiếp', data: 'control', title: 'Proxy chuẩn bị gọi backend', note: 'Tra URL backend theo tenant, chặn đích nội bộ, gỡ x-api-key rồi thêm x-request-id.', wire: 'Đọc mrapi-control\nGỡ header: x-api-key, Authorization, cookie\nThêm header: x-request-id' };
const FORWARDED = 'GET https://backend.company.com/v1/orders\nx-request-id: EXAMPLE_REQUEST_ID';
const telemetry = (packet: string, errorType?: string): Step => ({ at: PROXY, back: true, packet, data: 'telemetry', title: 'Proxy ghi telemetry', note: 'Ghi một dòng cho request này. Không ghi key, query hay body.', wire: `Ghi mrapi-telemetry\nrequestId, apiId, keyId, method, path\nstatus, latencyMs, region${errorType ? `\nerrorType: ${errorType}` : ''}` });
const relay = (packet: string, wire: string): Step => ({ at: APIGW, back: true, packet, title: 'API Gateway trả phản hồi', note: 'Phản hồi đi ngược qua API Gateway về server đối tác.', wire });
const received = (packet: string, note: string, wire: string, fail = false): Step => ({ at: CLIENT, back: true, fail, packet, title: 'Server đối tác nhận phản hồi', note, wire });

const OK_WIRE = 'HTTP/1.1 200 OK\nX-Mrapi-Source: upstream\n\n{ "orders": [{ "id": "ORD-1001", "status": "paid" }] }';
const successTail: Step[] = [authorized, proxied,
  { at: BACKEND, packet: 'GET /orders', title: 'Backend đích xử lý', note: 'Backend của đối tác nhận request đã gỡ API key và trả dữ liệu.', wire: FORWARDED },
  telemetry('200 OK'), relay('200 OK', OK_WIRE),
  received('200 OK', 'Status, header và body là phản hồi nguyên gốc của backend.', OK_WIRE)];

const UNAUTHORIZED = 'HTTP/1.1 401 Unauthorized\n\n{"message":"Unauthorized"}';
const FORBIDDEN = 'HTTP/1.1 403 Forbidden\nMã trong log authorizer: KEY_REVOKED';
const BAD_GATEWAY = 'HTTP/1.1 502 Bad Gateway\nX-Mrapi-Source: gateway\n\n{\n  "code": "UPSTREAM_UNREACHABLE",\n  "requestId": "EXAMPLE_REQUEST_ID"\n}';

export const SIMULATIONS: Simulation[] = [
  { id: 'success', label: 'Gọi thành công', region: 'sg', outcome: 'HTTP 200 · Phản hồi từ backend', ok: true, steps: [send('x-api-key: ••••••••'), resolve('Singapore', LOW_LATENCY), gateway(), ...successTail] },
  { id: 'missing', label: 'Thiếu API key', region: 'sg', outcome: 'HTTP 401 · Dừng ở API Gateway', ok: false, steps: [
    send('(không có x-api-key)'), resolve('Singapore', LOW_LATENCY),
    { ...gateway('(không có x-api-key)'), fail: true, title: 'API Gateway từ chối', note: 'Thiếu header bắt buộc nên request bị trả về ngay. Backend không nhận được gì.' },
    received('401', 'Request bị chặn trước proxy nên không có telemetry.', UNAUTHORIZED, true)] },
  { id: 'badkey', label: 'Sai API key', region: 'sg', outcome: 'HTTP 401 · Dừng ở authorizer', ok: false, steps: [
    send('x-api-key: ••••••••'), resolve('Singapore', LOW_LATENCY), gateway(),
    { at: AUTHORIZER, fail: true, packet: 'Kiểm tra key', data: 'control', title: 'Authorizer không tìm thấy key', note: 'Hash của key không có trong mrapi-control nên request bị từ chối.', wire: 'Đọc mrapi-control\nKhông có key khớp' },
    relay('401', UNAUTHORIZED), received('401', 'Request bị chặn trước proxy nên không có telemetry.', UNAUTHORIZED, true)] },
  { id: 'revoked', label: 'Key bị từ chối', region: 'sg', outcome: 'HTTP 403 · Dừng ở authorizer', ok: false, steps: [
    send('x-api-key: ••••••••'), resolve('Singapore', LOW_LATENCY), gateway(),
    { at: AUTHORIZER, fail: true, packet: 'Kiểm tra key', data: 'control', title: 'Authorizer chặn key', note: 'Key đã thu hồi hoặc không có quyền gọi API này. Nhờ Global Tables, Region kia cũng đọc được trạng thái thu hồi sau khi dữ liệu đồng bộ.', wire: 'Đọc mrapi-control\nstatus: revoked\nMã trong log authorizer: KEY_REVOKED' },
    relay('403', FORBIDDEN), received('403', 'Đối tác cần dùng key khác. Request bị chặn trước proxy nên không có telemetry.', FORBIDDEN, true)] },
  { id: 'upstream', label: 'Backend lỗi', region: 'sg', outcome: 'HTTP 502 · Gateway báo lỗi backend', ok: false, steps: [
    send('x-api-key: ••••••••'), resolve('Singapore', LOW_LATENCY), gateway(), authorized, proxied,
    { at: BACKEND, fail: true, packet: 'GET /orders', title: 'Không kết nối được backend', note: 'Lỗi nằm ở backend của đối tác, không phải lỗi của Region.', wire: `${FORWARDED}\nKết nối thất bại` },
    telemetry('502', 'UPSTREAM_UNREACHABLE'), relay('502', BAD_GATEWAY),
    received('502', 'X-Mrapi-Source: gateway cho biết phản hồi do gateway sinh ra.', BAD_GATEWAY, true)] },
  { id: 'failover', label: 'Singapore sự cố', region: 'tyo', regionNote: 'Singapore đang lỗi trong mô phỏng', outcome: 'HTTP 200 · Tokyo phục vụ thay', ok: true, steps: [
    send('x-api-key: ••••••••'), resolve('Tokyo', 'Health check Singapore thất bại nên Route 53 không trả về Region này nữa. DNS cache có thể làm client chuyển chậm hơn.'), gateway(), ...successTail] },
];

const NORMAL_MS = 1500;
const SPEEDS: [string, number][] = [['Chậm', 0.6], ['Vừa', 1], ['Nhanh', 1.8]];

export function RequestSimulator({ initial = 'success', autoPlay = false, locked = false }: { initial?: string; autoPlay?: boolean; locked?: boolean }) {
  const [id, setId] = useState(initial);
  const [index, setIndex] = useState(autoPlay ? 0 : -1);
  const [playing, setPlaying] = useState(autoPlay);
  const [speed, setSpeed] = useState(1);
  const [selected, setSelected] = useState(CLIENT);
  const simulation = SIMULATIONS.find(item => item.id === id) ?? SIMULATIONS[0];
  const { steps } = simulation;
  const last = steps.length - 1;
  const stepMs = NORMAL_MS / speed;
  const step = index >= 0 ? steps[index] : undefined;
  const seen = steps.slice(0, index + 1);
  const finished = index === last;

  useEffect(() => {
    if (!playing) return;
    if (finished) { setPlaying(false); return; }
    const timer = setTimeout(() => setIndex(value => value + 1), stepMs);
    return () => clearTimeout(timer);
  }, [playing, finished, index, stepMs]);

  const choose = (next: string) => { setId(next); setIndex(-1); setPlaying(false); };
  const toggle = () => {
    if (finished) { setIndex(0); setPlaying(true); }
    else if (playing) setPlaying(false);
    else { setIndex(value => Math.max(value, 0)); setPlaying(true); }
  };
  const position = `${((step?.at ?? CLIENT) + 0.5) / NODES.length * 100}%`;
  const stage = {
    '--sim-pos': position,
    '--sim-ms': `${stepMs * 0.7}ms`,
    '--sim-region': simulation.region === 'sg' ? 'var(--series-1)' : 'var(--series-2)',
  } as CSSProperties;
  const failed = step?.fail;
  const detail = NODES[selected];

  return <Card className="space-y-4">
    <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">Mô phỏng một request</h2><Tag tone="warning">Minh họa, không gọi AWS</Tag></div>
    {!locked && <div className="flex flex-wrap gap-2" role="group" aria-label="Chọn tình huống request">
      {SIMULATIONS.map(item => <button type="button" key={item.id} aria-pressed={id === item.id} onClick={() => choose(item.id)} className={`chip ${id === item.id ? 'chip-active' : ''}`}>{item.label}</button>)}
    </div>}

    <div className="sim-stage" style={stage}>
      <div className="sim-region" aria-hidden><span>{simulation.region === 'sg' ? 'Singapore · ap-southeast-1' : 'Tokyo · ap-northeast-1'}{simulation.regionNote ? ` · ${simulation.regionNote}` : ''}</span></div>
      <div className="sim-track" aria-hidden><span className="sim-track-fill" data-on={index >= 0} /></div>
      <ol className="sim-nodes">
        {NODES.map(({ id: nodeId, title, place, icon: Icon }, nodeIndex) => {
          const state = seen.some(item => item.fail && item.at === nodeIndex) ? 'failed' : step?.at === nodeIndex ? 'active' : seen.some(item => item.at === nodeIndex) ? 'passed' : 'idle';
          return <li key={nodeId}><button type="button" aria-pressed={index < 0 && selected === nodeIndex} data-state={state} onClick={() => setSelected(nodeIndex)} className="sim-node">
            <span className="sim-icon"><Icon aria-hidden className="size-5" /></span>
            <span className="min-w-0"><span className="block text-sm font-semibold text-ink">{title}</span><span className="block text-xs text-muted">{place}</span></span>
          </button></li>;
        })}
      </ol>
      {step && <div className="sim-packet" data-tone={failed ? 'error' : step.back ? 'back' : 'out'} aria-hidden>
        <span className="sim-dot" />
        <span className="sim-label">{step.back ? <ArrowLeft className="size-3" /> : <ArrowRight className="size-3" />}{step.packet}</span>
      </div>}
    </div>

    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={toggle} className="btn-primary">{playing ? <Pause aria-hidden className="size-4" /> : <Play aria-hidden className="size-4" />}{playing ? 'Tạm dừng' : finished ? 'Chạy lại' : index >= 0 ? 'Tiếp tục' : 'Chạy mô phỏng'}</button>
      <button type="button" disabled={finished} onClick={() => { setPlaying(false); setIndex(value => Math.min(value + 1, last)); }} className="chip"><SkipForward aria-hidden className="size-4" />Từng bước</button>
      <button type="button" disabled={index < 0} onClick={() => { setPlaying(false); setIndex(-1); }} className="chip"><RotateCcw aria-hidden className="size-4" />Về đầu</button>
      <div className="ml-auto flex items-center gap-1" role="group" aria-label="Tốc độ mô phỏng">
        <FastForward aria-hidden className="size-4 text-muted" />
        {SPEEDS.map(([label, value]) => <button type="button" key={label} aria-pressed={speed === value} onClick={() => setSpeed(value)} className={`chip chip-small ${speed === value ? 'chip-active' : ''}`}>{label}</button>)}
      </div>
    </div>

    <div className="grid gap-4 lg:grid-cols-2">
      <div className="min-w-0 space-y-3">
        <div aria-live="polite" className="rounded-xl bg-raised p-4 text-sm text-ink2">
          {step ? <><p className="font-semibold text-ink">Bước {index + 1}/{steps.length}: {step.title}</p><p className="mt-1">{step.note}</p></> : <><p className="font-semibold text-ink">{detail.title}</p><p className="mt-1">{detail.detail}</p></>}
        </div>
        {finished && <p role="status" className={`flex items-center gap-2 rounded-xl border p-3 text-sm font-semibold ${simulation.ok ? 'border-good bg-good/10' : 'border-critical bg-critical/10'}`}>{simulation.ok ? <CheckCircle2 aria-hidden className="size-4 shrink-0 text-good" /> : <XCircle aria-hidden className="size-4 shrink-0 text-critical" />}{simulation.outcome}</p>}
        <div className="grid gap-2 sm:grid-cols-2">
          {([['control', 'mrapi-control', 'Key, phạm vi, cấu hình API'], ['telemetry', 'mrapi-telemetry', 'Một dòng cho mỗi request vào proxy']] as const).map(([table, name, hint]) => <div key={table} data-on={step?.data === table} className="sim-table"><Database aria-hidden className="size-4 shrink-0" /><div className="min-w-0"><p className="text-sm font-semibold text-ink">{name}</p><p className="text-xs text-ink2">{hint}</p></div></div>)}
        </div>
      </div>
      <div className="code-window min-w-0">
        <div className="code-bar"><span className="code-dots" aria-hidden><i /><i /><i /></span><span className="truncate">{step ? (step.back ? 'Phản hồi tại chặng này' : 'Dữ liệu tại chặng này') : 'Dữ liệu tại chặng này'}</span></div>
        <pre className="min-h-32 overflow-x-auto p-3 text-xs leading-6"><code>{step?.wire ?? 'Bấm Chạy mô phỏng để xem request đi qua từng chặng.'}</code></pre>
      </div>
    </div>
  </Card>;
}
