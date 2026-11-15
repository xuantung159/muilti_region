// Demo failover: người xem tự bấm giả lập "một Region gặp lỗi" và theo dõi Route 53 chuyển request
// sang Region còn lại, rồi tự quay về. Mọi số liệu lấy thật từ GET /api/demo/failover
// (health check Route 53, TestDNSAnswer, một request thật tới api.multi-region.io.vn/health).
import { AlertTriangle, CheckCircle2, CircleHelp, Clock, Globe2, LogIn, Play, RefreshCw, Server, Square, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, Tag } from '../components/ui';
import { formatDuration } from '../domain/format';
import { REGIONS, type RegionCode, regionName } from '../domain/types';
import { portalCall } from '../portal/client';

export type FailoverPhase = 'idle' | 'waiting_unhealthy' | 'waiting_dns' | 'failed_over' | 'recovering' | 'cooldown';
type OutageInfo = { region: RegionCode; regionName: string; startedAt: string; until: string; endedEarlyAt: string | null; startedByMe: boolean };
export interface FailoverStatus {
  region: string;
  now: string;
  outage: (OutageInfo & { remainingSeconds: number }) | null;
  cooldown: { until: string; remainingSeconds: number } | null;
  lastOutage: OutageInfo | null;
  phase: FailoverPhase;
  canStart: boolean;
  blockedReason: string | null;
  quota: { used: number; max: number | null };
  limits: { defaultMinutes: number; minMinutes: number; maxMinutes: number; cooldownMinutes: number; dailyPerTenant: number };
  healthChecks: { region: RegionCode; status: 'healthy' | 'unhealthy' | 'unknown'; okCheckers: number; totalCheckers: number; error?: string }[];
  dns: { id: string; label: string; resolverIp: string; expectedRegion: RegionCode; answerIps: string[]; answeredRegion: RegionCode | null; error?: string }[];
  probe: { from: string | null; ip: string | null; status: number | null; servedRegion: RegionCode | null; latencyMs: number | null; error?: string };
  observedAt: string;
  timeline: { key: string; label: string; fromSeconds: number; toSeconds: number; after: 'start' | 'end' }[];
}

const POLL_MS = 10_000;
const PATH = 'demo/failover';

const PHASES: Record<FailoverPhase, { label: string; tone: 'neutral' | 'warning' | 'accent' | 'critical' }> = {
  idle: { label: 'Bình thường', tone: 'neutral' },
  waiting_unhealthy: { label: 'Đã bật lỗi, chờ health check', tone: 'warning' },
  waiting_dns: { label: 'Health check lỗi, chờ Route 53 chuyển', tone: 'warning' },
  failed_over: { label: 'Đã chuyển sang Region còn lại', tone: 'critical' },
  recovering: { label: 'Đang quay về', tone: 'accent' },
  cooldown: { label: 'Đã phục hồi, đang chờ lượt sau', tone: 'accent' },
};
const HEALTH_LABEL = { healthy: 'Healthy', unhealthy: 'Unhealthy', unknown: 'Không rõ' } as const;
const name = (code: string | null | undefined) => (code && REGIONS.some((r) => r.code === code) ? regionName(code as RegionCode) : code ?? 'Không rõ');
const clock = (ms: number) => new Date(ms).toLocaleTimeString('vi-VN', { hour12: false });
const mmss = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.max(0, Math.floor(seconds % 60))).padStart(2, '0')}`;

type LogEntry = { at: number; text: string; sinceStart: number | null };

// So sánh hai lần quan sát, sinh dòng nhật ký cho mỗi thay đổi (chỉ từ dữ liệu thật).
export function changesBetween(prev: FailoverStatus | null, next: FailoverStatus): string[] {
  const out: string[] = [];
  if (!prev) {
    out.push(`Bắt đầu theo dõi. Request thật đang được ${name(next.probe.servedRegion)} phục vụ.`);
    return out;
  }
  if (!prev.outage && next.outage) out.push(`Bắt đầu giả lập lỗi ở ${next.outage.regionName}: /health trả 503.`);
  if (prev.outage && !next.outage) {
    out.push(next.lastOutage?.endedEarlyAt ? `Kết thúc sớm giả lập ở ${prev.outage.regionName}: /health trả 200 trở lại.` : `Hết hạn giả lập ở ${prev.outage.regionName}: /health trả 200 trở lại.`);
  }
  for (const check of next.healthChecks) {
    const before = prev.healthChecks.find((c) => c.region === check.region)?.status;
    if (before && before !== check.status && check.status !== 'unknown') {
      out.push(`Health check Route 53 của ${name(check.region)}: ${HEALTH_LABEL[before]} → ${HEALTH_LABEL[check.status]}.`);
    }
  }
  for (const answer of next.dns) {
    const before = prev.dns.find((d) => d.id === answer.id)?.answeredRegion;
    if (before && answer.answeredRegion && before !== answer.answeredRegion) {
      out.push(`Route 53 trả cho ${answer.label}: ${name(before)} → ${name(answer.answeredRegion)}.`);
    }
  }
  if (prev.probe.servedRegion && next.probe.servedRegion && prev.probe.servedRegion !== next.probe.servedRegion) {
    out.push(`Request thật chuyển: ${name(prev.probe.servedRegion)} → ${name(next.probe.servedRegion)} phục vụ.`);
  }
  if (prev.phase !== next.phase) out.push(`Giai đoạn: ${PHASES[next.phase].label}.`);
  return out;
}

function HealthIcon({ status }: { status: 'healthy' | 'unhealthy' | 'unknown' }) {
  if (status === 'healthy') return <CheckCircle2 aria-hidden className="size-4 text-good" />;
  if (status === 'unhealthy') return <XCircle aria-hidden className="size-4 text-critical" />;
  return <CircleHelp aria-hidden className="size-4 text-muted" />;
}

export function FailoverDemo({ token }: { token: string | null }) {
  const [data, setData] = useState<FailoverStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<RegionCode>('ap-southeast-1');
  const [minutes, setMinutes] = useState(5);
  const [confirming, setConfirming] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [tick, setTick] = useState(() => Date.now());
  const prevRef = useRef<FailoverStatus | null>(null);
  const offsetRef = useRef(0); // giờ máy chủ - giờ trình duyệt

  const accept = useCallback((next: FailoverStatus) => {
    const now = Date.now();
    offsetRef.current = Date.parse(next.now) - now;
    const startedAt = next.outage?.startedAt ?? (next.phase !== 'idle' ? next.lastOutage?.startedAt : undefined);
    const sinceStart = startedAt ? Math.max(0, (Date.parse(next.now) - Date.parse(startedAt)) / 1000) : null;
    const lines = changesBetween(prevRef.current, next);
    prevRef.current = next;
    if (lines.length) setLog((old) => [...lines.map((text) => ({ at: now, text, sinceStart })).reverse(), ...old].slice(0, 100));
    setData(next);
    setError(null);
  }, []);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!token) return;
    try {
      accept(await portalCall<FailoverStatus>(PATH, token, 'GET', undefined, signal));
    } catch (err) {
      if (signal?.aborted) return;
      setError(err instanceof Error ? err.message : 'Không tải được trạng thái.');
    }
  }, [accept, token]);

  useEffect(() => {
    if (!token) return undefined;
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = setInterval(() => { void refresh(); }, POLL_MS);
    return () => { controller.abort(); clearInterval(timer); };
  }, [refresh, token]);

  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const act = async (method: 'POST' | 'DELETE', body?: unknown) => {
    setBusy(true);
    try {
      accept(await portalCall<FailoverStatus>(PATH, token, method, body));
      setConfirming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Thao tác không thành công.');
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <Card>
        <div className="flex items-center gap-2 text-sm font-semibold text-ink"><LogIn aria-hidden className="size-4" />Cần đăng nhập</div>
        <p className="mt-2 text-sm text-ink2">Đăng nhập ở trang Portal (hoặc đăng ký tài khoản miễn phí) để tự giả lập một Region gặp lỗi và xem failover.</p>
      </Card>
    );
  }

  const serverNow = tick + offsetRef.current;
  const outage = data?.outage ?? null;
  const remaining = outage ? Math.max(0, (Date.parse(outage.until) - serverNow) / 1000) : 0;
  const startedAt = outage?.startedAt ?? data?.lastOutage?.startedAt;
  const elapsed = startedAt ? Math.max(0, (serverNow - Date.parse(startedAt)) / 1000) : null;
  const limits = data?.limits ?? { minMinutes: 3, maxMinutes: 10, defaultMinutes: 5, cooldownMinutes: 3, dailyPerTenant: 5 };
  const minuteOptions = Array.from({ length: limits.maxMinutes - limits.minMinutes + 1 }, (_, i) => limits.minMinutes + i);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-ink">Giả lập một Region gặp lỗi</h2>
            <p className="mt-1 text-sm text-ink2">
              Bấm bắt đầu, Region được chọn sẽ trả lỗi ở <code>/health</code>. Route 53 thấy health check lỗi và trả Region còn lại cho
              mọi người dùng. Hết thời gian thì tự phục hồi.
            </p>
          </div>
          {data && <Tag tone={PHASES[data.phase].tone}>{PHASES[data.phase].label}</Tag>}
        </div>

        <div role="note" className="mt-3 flex gap-2 rounded-lg border border-warning bg-warning/10 p-3 text-sm text-ink">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>
            Đây là thao tác thật trên hệ thống đang chạy: trong thời gian giả lập, toàn bộ người dùng được chuyển sang Region còn lại
            (request vẫn thành công, chỉ đổi nơi phục vụ). Hệ thống tự phục hồi khi hết hạn; mỗi lúc chỉ một sự cố, không bao giờ cả hai
            Region cùng lỗi.
          </span>
        </div>

        {error && <p role="alert" className="mt-3 text-sm text-critical">{error}</p>}

        {outage ? (
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <div>
              <div className="text-xs text-ink2">Đang giả lập lỗi</div>
              <div className="text-base font-semibold text-ink">{outage.regionName} ({outage.region})</div>
            </div>
            <div>
              <div className="text-xs text-ink2">Còn lại</div>
              <div className="font-mono text-xl font-semibold tabular-nums text-ink" aria-label="Thời gian còn lại">{mmss(remaining)}</div>
            </div>
            {elapsed !== null && (
              <div>
                <div className="text-xs text-ink2">Đã trôi qua</div>
                <div className="font-mono text-xl font-semibold tabular-nums text-ink">{mmss(elapsed)}</div>
              </div>
            )}
            <button type="button" disabled={busy} onClick={() => void act('DELETE')}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-raised disabled:opacity-50">
              <Square aria-hidden className="size-4" />Kết thúc sớm
            </button>
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-ink2">
              Region bị lỗi
              <select value={target} onChange={(e) => setTarget(e.target.value as RegionCode)} className="h-9 rounded-md border border-line bg-surface px-2 text-sm font-normal text-ink">
                {REGIONS.map((r) => <option key={r.code} value={r.code}>{r.name} ({r.code})</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-ink2">
              Thời lượng
              <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="h-9 rounded-md border border-line bg-surface px-2 text-sm font-normal text-ink">
                {minuteOptions.map((m) => <option key={m} value={m}>{m} phút</option>)}
              </select>
            </label>
            {confirming ? (
              <>
                <button type="button" disabled={busy} onClick={() => void act('POST', { region: target, minutes })}
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-critical px-3 text-sm font-medium text-white disabled:opacity-50">
                  <Play aria-hidden className="size-4" />Xác nhận làm lỗi {regionName(target)}
                </button>
                <button type="button" onClick={() => setConfirming(false)} className="h-9 rounded-md border border-line px-3 text-sm text-ink hover:bg-raised">Huỷ</button>
              </>
            ) : (
              <button type="button" disabled={busy || !data?.canStart} onClick={() => setConfirming(true)}
                className="inline-flex h-9 items-center gap-2 rounded-md bg-accent px-3 text-sm font-medium text-on-accent disabled:opacity-50">
                <Play aria-hidden className="size-4" />Bắt đầu giả lập
              </button>
            )}
            {data?.cooldown && <span className="text-sm text-ink2">Chờ hồi phục: {mmss(Math.max(0, (Date.parse(data.cooldown.until) - serverNow) / 1000))}</span>}
          </div>
        )}
        {data?.blockedReason && !outage && <p className="mt-2 text-sm text-ink2">{data.blockedReason}</p>}
        {data && data.quota.max !== null &&<p className="mt-1 text-xs text-muted">Đã dùng {data.quota.used}/{data.quota.max} lượt hôm nay.</p>}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {REGIONS.map((r) => {
          const check = data?.healthChecks.find((c) => c.region === r.code);
          const isDown = outage?.region === r.code;
          const serving = data?.probe.servedRegion === r.code;
          return (
            <Card key={r.code} className={isDown ? 'border-critical' : serving ? 'border-good' : ''}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-semibold text-ink"><Server aria-hidden className="size-4" />{r.name}</div>
                <span className="text-xs text-muted">{r.code}</span>
              </div>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-ink2">Health check Route 53</dt>
                  <dd className="flex items-center gap-1.5 font-medium text-ink" data-testid={`health-${r.code}`}>
                    {check ? <><HealthIcon status={check.status} />{HEALTH_LABEL[check.status]}</> : '…'}
                    {check && check.totalCheckers > 0 && <span className="text-xs font-normal text-muted">({check.okCheckers}/{check.totalCheckers} điểm OK)</span>}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-ink2">/health</dt>
                  <dd className="font-medium text-ink">{isDown ? 'Đang giả lập lỗi (503)' : 'Bình thường'}</dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-ink2">Request thật</dt>
                  <dd className="font-medium text-ink">{serving ? 'Đang phục vụ' : '—'}</dd>
                </div>
              </dl>
            </Card>
          );
        })}
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink"><Globe2 aria-hidden className="size-4" />Route 53 đang trả Region nào</h3>
          <button type="button" onClick={() => void refresh()} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-2 text-xs text-ink hover:bg-raised">
            <RefreshCw aria-hidden className="size-3.5" />Làm mới
          </button>
        </div>
        {data ? (
          <>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-ink2"><th className="py-1 pr-3 font-medium">Người dùng ở</th><th className="py-1 pr-3 font-medium">Bình thường</th><th className="py-1 font-medium">Route 53 trả bây giờ</th></tr></thead>
                <tbody>
                  {data.dns.map((d) => (
                    <tr key={d.id} className="border-t border-line">
                      <td className="py-1.5 pr-3 text-ink">{d.label}</td>
                      <td className="py-1.5 pr-3 text-ink2">{name(d.expectedRegion)}</td>
                      <td className="py-1.5 font-medium text-ink" data-testid={`dns-${d.id}`}>
                        {d.error ? <span className="font-normal italic text-muted">{d.error}</span> : name(d.answeredRegion)}
                        {data.phase !== 'idle' && d.answeredRegion && d.answeredRegion !== d.expectedRegion && <span className="ml-1 text-xs font-normal text-warning">(đã chuyển)</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-sm text-ink">
              Request thật <code>GET https://api.multi-region.io.vn/health</code> từ Lambda portal ở {name(data.probe.from)}:{' '}
              {data.probe.error ? <span className="text-critical">{data.probe.error}</span> : (
                <strong data-testid="probe">HTTP {data.probe.status} · X-Served-Region: {data.probe.servedRegion ?? 'không có'} ({name(data.probe.servedRegion)}) · {data.probe.latencyMs} ms</strong>
              )}
            </p>
            <p className="mt-1 text-xs text-muted">
              Cột "Route 53 trả bây giờ" dùng Route 53 Test DNS answer với IP resolver đại diện của từng nước. Máy tính hoặc ISP có thể giữ
              cache DNS thêm vài chục giây nên client thật chuyển chậm hơn một chút. Cập nhật mỗi {POLL_MS / 1000} giây, lần đo gần nhất {clock(Date.parse(data.observedAt))}.
            </p>
          </>
        ) : !error && <p className="mt-3 text-sm text-ink2">Đang tải trạng thái…</p>}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink"><Clock aria-hidden className="size-4" />Nhật ký thay đổi (quan sát thật)</h3>
          {log.length === 0 ? <p className="mt-2 text-sm text-ink2">Chưa có thay đổi.</p> : (
            <ol className="mt-2 space-y-1.5 text-sm" aria-label="Nhật ký thay đổi">
              {log.map((entry, i) => (
                <li key={`${entry.at}-${i}`} className="flex gap-2">
                  <span className="shrink-0 font-mono text-xs tabular-nums text-ink2">{clock(entry.at)}{entry.sinceStart !== null && ` · +${mmss(entry.sinceStart)}`}</span>
                  <span className="text-ink">{entry.text}</span>
                </li>
              ))}
            </ol>
          )}
          <p className="mt-2 text-xs text-muted">"+mm:ss" là thời gian kể từ lúc bật giả lập, đo theo lần cập nhật 10 giây nên sai số tới khoảng 10 giây.</p>
        </Card>
        <Card>
          <h3 className="text-sm font-semibold text-ink">Diễn biến dự kiến</h3>
          <ol className="mt-2 space-y-1.5 text-sm">
            {(data?.timeline ?? []).map((step) => (
              <li key={step.key} className="flex gap-2">
                <span className="shrink-0 font-mono text-xs tabular-nums text-ink2">
                  {step.after === 'start' ? 'bật' : 'hết hạn'}{step.toSeconds > 0 && ` +${formatDuration(step.fromSeconds)}–${formatDuration(step.toSeconds)}`}
                </span>
                <span className="text-ink">{step.label}</span>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-muted">Theo cấu hình health check (chu kỳ 30 giây, ngưỡng 3 lần) và số đo thủ công trước đây: chuyển sau khoảng 2,5 phút, quay về sau khoảng 2 phút.</p>
        </Card>
      </div>
    </div>
  );
}
