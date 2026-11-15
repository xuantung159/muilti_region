// Demo cho người chấm tự bấm: chọn một nước → Route 53 trả lời như khi resolver ở nước đó (mô phỏng DNS),
// rồi portal gửi request HTTPS thật tới đúng IP được chọn và đọc X-Served-Region.
import { CheckCircle2, CircleHelp, Globe2, Play, PlayCircle, Square, XCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RoutingMap } from '../components/RoutingMap';
import { Card, EmptyState, Select, Tag } from '../components/ui';
import { REGIONS, type RegionCode, regionName, type RouteStat } from '../domain/types';
import { PortalError, portalCall } from '../portal/client';

export interface GeoCountry { code: string; name: string; city: string; ip: string; live: boolean }
export interface GeoCatalog { record: string; hostedZoneId: string; portalRegion: string | null; servingRegions: string[]; countries: GeoCountry[] }
export interface GeoStep { id: 'dns' | 'locate' | 'request' | 'live'; kind: 'simulated' | 'real'; ok: boolean; ms: number; title: string; detail: string }
export interface GeoLive { source: 'portal-lambda' | 'probe-lambda'; fromRegion: string | null; sourceIp: string | null; status: number | null; servedRegion: string | null; latencyMs: number | null }
export interface GeoResult {
  country: string; countryName: string; city: string; resolverIp: string; ecsSubnet: string;
  dnsAnswer: string[]; chosenRegion: string | null; chosenBy: 'endpoint-ip' | 'ptr' | 'served-header' | null;
  servedRegion: string | null; status: number | null; latencyMs: number | null; match: boolean | null;
  portalRegion: string | null; live: GeoLive | null; steps: GeoStep[]; testedAt: string;
}

const isRegion = (code: string | null | undefined): code is RegionCode => REGIONS.some((r) => r.code === code);
const regionLabel = (code: string | null | undefined) => (isRegion(code) ? `${regionName(code)} (${code})` : code ?? 'Không rõ');
const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Lỗi không xác định.');

function StepIcon({ ok }: { ok: boolean }) {
  return ok
    ? <CheckCircle2 aria-label="Thành công" className="size-4 shrink-0 text-good" />
    : <XCircle aria-label="Thất bại" className="size-4 shrink-0 text-critical" />;
}

function MatchTag({ match }: { match: boolean | null }) {
  if (match === true) return <Tag tone="accent">Khớp</Tag>;
  if (match === false) return <Tag tone="critical">Không khớp</Tag>;
  return <Tag>Chưa đối chiếu được</Tag>;
}

function ResultDetail({ result }: { result: GeoResult }) {
  return (
    <div className="space-y-4" data-testid="geo-result">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-line p-3">
          <p className="text-xs text-ink2">Route 53 chọn (theo IP {result.dnsAnswer[0] ?? '—'})</p>
          <p className="mt-1 font-semibold text-ink">{regionLabel(result.chosenRegion)}</p>
          {result.chosenBy === 'served-header' && <p className="mt-1 text-xs text-muted">Không định vị được IP qua DNS, lấy theo header.</p>}
        </div>
        <div className="rounded-xl border border-line p-3">
          <p className="text-xs text-ink2">X-Served-Region (request thật)</p>
          <p className="mt-1 font-semibold text-ink">{regionLabel(result.servedRegion)}</p>
          <p className="mt-1 text-xs text-ink2">HTTP {result.status ?? '—'} · {result.latencyMs ?? '—'} ms</p>
        </div>
        <div className="rounded-xl border border-line p-3">
          <p className="text-xs text-ink2">Đối chiếu</p>
          <div className="mt-1"><MatchTag match={result.match} /></div>
          <p className="mt-1 text-xs text-ink2">Request gửi từ portal ở {result.portalRegion ?? '?'}</p>
        </div>
      </div>

      <ol className="space-y-2" aria-label="Các bước">
        {result.steps.map((s, i) => (
          <li key={s.id} className="flex gap-3 rounded-xl border border-line p-3">
            <span className="mt-0.5 text-xs font-semibold tabular-nums text-ink2">{i + 1}</span>
            <StepIcon ok={s.ok} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-ink">{s.title}</span>
                {s.kind === 'simulated' ? <Tag tone="warning">Mô phỏng DNS</Tag> : <Tag tone="accent">Thật</Tag>}
                <span className="text-xs tabular-nums text-muted">{s.ms} ms</span>
              </div>
              <p className="mt-1 break-words text-sm text-ink2">{s.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function SummaryTable({ rows }: { rows: GeoResult[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <thead className="border-b border-line text-xs text-ink2">
          <tr>
            <th className="px-3 py-2 font-medium">Nước</th>
            <th className="px-3 py-2 font-medium">IP resolver giả lập</th>
            <th className="px-3 py-2 font-medium">Route 53 chọn</th>
            <th className="px-3 py-2 font-medium">X-Served-Region</th>
            <th className="px-3 py-2 font-medium">Thời gian</th>
            <th className="px-3 py-2 font-medium">Request thật từ nước đó</th>
            <th className="px-3 py-2 font-medium">Kết quả</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.country} className="border-b border-line last:border-0">
              <td className="px-3 py-2 text-ink">{r.countryName} <span className="text-xs text-ink2">({r.country})</span></td>
              <td className="px-3 py-2 font-mono text-xs text-ink2">{r.resolverIp}</td>
              <td className="px-3 py-2 text-ink">{isRegion(r.chosenRegion) ? regionName(r.chosenRegion) : '—'}</td>
              <td className="px-3 py-2 text-ink">{isRegion(r.servedRegion) ? regionName(r.servedRegion) : r.servedRegion ?? '—'}</td>
              <td className="px-3 py-2 tabular-nums text-ink2">{r.latencyMs != null ? `${r.latencyMs} ms` : '—'}</td>
              <td className="px-3 py-2 text-ink2">{r.live ? `${r.live.fromRegion ?? '?'} → ${isRegion(r.live.servedRegion) ? regionName(r.live.servedRegion) : r.live.servedRegion ?? 'lỗi'}` : '—'}</td>
              <td className="px-3 py-2"><MatchTag match={r.match} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function GeoDemo({ token }: { token: string | null }) {
  const [catalog, setCatalog] = useState<GeoCatalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState('');
  const [results, setResults] = useState<Record<string, GeoResult>>({});
  const [current, setCurrent] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef(false);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    setLoadError(null);
    portalCall<GeoCatalog>('demo/geo', token, 'GET', undefined, controller.signal)
      .then((data) => { setCatalog(data); setSelected((s) => s || data.countries[0]?.code || ''); })
      .catch((e) => { if (!controller.signal.aborted) setLoadError(errorText(e)); });
    return () => controller.abort();
  }, [token]);

  const runOne = useCallback(async (code: string) => {
    setRunning(code);
    setError(null);
    try {
      const result = await portalCall<GeoResult>('demo/geo', token, 'POST', { country: code });
      setResults((prev) => ({ ...prev, [code]: result }));
      setCurrent(code);
      return true;
    } catch (e) {
      setError(`${code}: ${errorText(e)}`);
      return !(e instanceof PortalError && e.status === 401);
    } finally {
      setRunning(null);
    }
  }, [token]);

  const runAll = useCallback(async () => {
    if (!catalog) return;
    stopRef.current = false;
    const list = catalog.countries;
    setProgress({ done: 0, total: list.length });
    // Tuần tự để không vượt giới hạn 5 request/giây của API Route 53.
    for (let i = 0; i < list.length && !stopRef.current; i++) {
      if (!(await runOne(list[i].code))) break;
      setProgress({ done: i + 1, total: list.length });
    }
    setProgress(null);
  }, [catalog, runOne]);

  const ordered = useMemo(
    () => (catalog?.countries ?? []).map((c) => results[c.code]).filter((r): r is GeoResult => Boolean(r)),
    [catalog, results],
  );
  const routes: RouteStat[] = useMemo(
    () => ordered.flatMap((r) => (isRegion(r.servedRegion) ? [{ country: r.country, servedRegion: r.servedRegion, requests: 1, lastSeen: Date.parse(r.testedAt) }] : [])),
    [ordered],
  );

  if (!token) {
    return (
      <Card>
        <EmptyState title="Cần đăng nhập để chạy demo">
          Đăng nhập ở trang Cổng doanh nghiệp, sau đó quay lại đây để gửi request từ các nước.
        </EmptyState>
      </Card>
    );
  }

  const busy = running !== null || progress !== null;
  const shown = current ? results[current] : undefined;
  const country = catalog?.countries.find((c) => c.code === selected);

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex items-center gap-2">
          <Globe2 aria-hidden className="size-5 text-ink2" />
          <h2 className="text-lg font-semibold text-ink">Gửi request từ một nước bất kỳ</h2>
        </div>
        <div className="mt-2 space-y-1 text-sm text-ink2">
          <p>
            Record <code className="font-mono">{catalog?.record ?? 'api.multi-region.io.vn'}</code> dùng định tuyến <b>latency</b> của Route 53:
            Route 53 nhìn IP của DNS resolver (hoặc EDNS Client Subnet), tra bảng độ trễ mạng AWS tự đo, và trả IP của Region có độ trễ thấp nhất
            trong hai Region đang khoẻ (Singapore, Tokyo).
          </p>
          <p>
            <Tag tone="warning">Mô phỏng DNS</Tag> Bước 1 dùng API <code className="font-mono">TestDNSAnswer</code>: Route 53 trả lời đúng như khi resolver ở nước đó,
            nhưng không có gói tin nào thật sự đi từ nước đó.{' '}
            <Tag tone="accent">Thật</Tag> Bước 3 là request HTTPS thật tới đúng IP Route 53 vừa chọn, gửi từ máy chủ portal, và đọc header <code className="font-mono">X-Served-Region</code>.
            Nước có đánh dấu "có request thật" còn được gọi thêm từ máy chủ đặt tại chính nước đó, qua DNS thật.
          </p>
        </div>

        {loadError && <p role="alert" className="mt-3 text-sm text-critical">{loadError}</p>}
        {!catalog && !loadError && <p role="status" className="mt-3 text-sm text-ink2">Đang tải danh sách nước…</p>}

        {catalog && (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <Select label="Nước" value={selected} onChange={(e) => setSelected(e.target.value)} disabled={busy}>
              {catalog.countries.map((c) => (
                <option key={c.code} value={c.code}>{c.name} – {c.city}{c.live ? ' (có request thật)' : ''}</option>
              ))}
            </Select>
            <button type="button" disabled={busy || !selected} onClick={() => void runOne(selected)}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-accent px-3 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50">
              <Play aria-hidden className="size-4" />{running && !progress ? 'Đang gửi…' : 'Gửi request'}
            </button>
            {progress ? (
              <button type="button" onClick={() => { stopRef.current = true; }}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-raised">
                <Square aria-hidden className="size-4" />Dừng ({progress.done}/{progress.total})
              </button>
            ) : (
              <button type="button" disabled={busy} onClick={() => void runAll()}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-raised disabled:opacity-50">
                <PlayCircle aria-hidden className="size-4" />Chạy tất cả các nước
              </button>
            )}
            {country && <span className="text-xs text-ink2">IP đại diện: <span className="font-mono">{country.ip}</span> (dải IP AWS/ISP tại {country.city})</span>}
          </div>
        )}
        {error && <p role="alert" className="mt-3 text-sm text-critical">{error}</p>}
      </Card>

      {shown && (
        <Card>
          <h3 className="mb-3 font-semibold text-ink">{shown.countryName} → {regionLabel(shown.servedRegion)}</h3>
          <ResultDetail result={shown} />
        </Card>
      )}

      {ordered.length > 0 ? (
        <>
          <Card>
            <h3 className="mb-3 font-semibold text-ink">Bản đồ kết quả</h3>
            <RoutingMap routes={routes} />
          </Card>
          <Card>
            <h3 className="mb-3 font-semibold text-ink">Tổng hợp nước → Region</h3>
            <SummaryTable rows={ordered} />
          </Card>
        </>
      ) : catalog && (
        <EmptyState title="Chưa chạy nước nào">
          <span className="inline-flex items-center gap-1"><CircleHelp aria-hidden className="size-4" />Chọn một nước rồi bấm "Gửi request", hoặc "Chạy tất cả các nước".</span>
        </EmptyState>
      )}
    </div>
  );
}
