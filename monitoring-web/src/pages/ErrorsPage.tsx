import { useSnapshot } from '../app/data';
import { useSettings } from '../app/settings';
import { type ChartRow, TimeChart } from '../components/charts';
import { DataToolbar } from '../components/Toolbar';
import { Card, EmptyState, NotAvailable, PageHeader, QueryBoundary, Tag } from '../components/ui';
import { formatDateTime, formatNumber, formatPct } from '../domain/format';
import { RANGES } from '../domain/range';
import { ERROR_CLASS_INFO, errorSplitRow, partialTimes, seriesHasTimeout, timeoutPoint } from '../domain/report';
import { ERROR_CLASSES, type ErrorClass, type MonitoringSnapshot, type RegionCode, type RegionFilter, regionName, type RegionSnapshot, REGIONS } from '../domain/types';

const REGION_COLOR: Record<RegionCode, string> = { 'ap-southeast-1': 'var(--series-1)', 'ap-northeast-1': 'var(--series-2)' };

// 4xx là lỗi phía client/cấu hình, không phải sự cố: nhãn trung tính màu 4xx. 5xx mới dùng tông critical.
export function ErrorClassTag({ errorClass }: { errorClass: ErrorClass }) {
  const info = ERROR_CLASS_INFO[errorClass];
  if (info.family === '4xx')
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-ink" data-family="4xx">
        <span aria-hidden className="size-2 rounded-sm" style={{ background: 'var(--error-4xx)' }} />
        {info.label}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap" data-family="5xx">
      <Tag tone="critical">{errorClass === 'timeout' ? 'Timeout' : '5xx'}</Tag>
      <span className="text-xs text-ink">{info.label}</span>
    </span>
  );
}

const pctOf = (part: number, total: number) => (total > 0 ? formatPct((part / total) * 100) : null);

function CountCell({ count, total }: { count: number | null; total: number | null }) {
  if (count === null) return <NotAvailable />;
  const pct = total !== null ? pctOf(count, total) : null;
  return (
    <>
      {formatNumber(count)}
      {pct && <span className="ml-1 text-xs font-normal text-ink2">({pct})</span>}
    </>
  );
}

// Số đếm theo Region: ưu tiên regions[].stats; backend cũ thì cộng các ô của series (cùng nguồn telemetry).
function regionCounts(snapshot: MonitoringSnapshot, r: RegionSnapshot) {
  if (r.traffic) return { requests: r.traffic.requests, error4xx: r.traffic.error4xx, error5xx: r.traffic.error5xx, timeout: r.traffic.timeout as number | null, classes: r.traffic.errorsByClass };
  const buckets = snapshot.series.map((p) => p.regions[r.region]).filter(Boolean);
  if (buckets.length === 0) return null;
  const sum = (pick: (b: (typeof buckets)[number]) => number) => buckets.reduce((s, b) => s + pick(b), 0);
  const timeout = buckets.every((b) => typeof b.timeout === 'number') ? sum((b) => b.timeout ?? 0) : null;
  return { requests: sum((b) => b.requests), error4xx: sum((b) => b.error4xx), error5xx: sum((b) => b.error5xx), timeout, classes: null };
}

function ErrorsByRegion({ snapshot, codes }: { snapshot: MonitoringSnapshot; codes: RegionCode[] }) {
  const regions = snapshot.regions.filter((r) => codes.includes(r.region));
  const counts = regions.map((r) => ({ region: r.region, c: regionCounts(snapshot, r) }));
  return (
    <Card className="p-0">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">Lỗi theo Region</h2>
        <p className="mt-0.5 text-xs text-ink2">Số request lỗi (tỷ lệ trên tổng request của Region) trong {RANGES[snapshot.range].label} qua. 4xx là lỗi phía client hoặc cấu hình, không phải sự cố hạ tầng.</p>
      </div>
      <div className="overflow-x-auto">
        <table aria-label="Lỗi theo Region" className="w-full min-w-[32rem] text-left text-sm">
          <thead className="text-xs text-ink2">
            <tr className="border-b border-line">
              <th className="px-4 py-3 font-medium">Loại</th>
              {counts.map(({ region }) => (
                <th key={region} className="px-4 py-3 text-right font-medium">
                  <div className="text-sm font-semibold text-ink">{regionName(region)}</div>
                  <div>{region}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            <tr className="border-b border-line">
              <td className="px-4 py-2.5 text-ink2">Request</td>
              {counts.map(({ region, c }) => (
                <td key={region} className="px-4 py-2.5 text-right font-semibold text-ink">
                  {c ? formatNumber(c.requests) : <NotAvailable />}
                </td>
              ))}
            </tr>
            {(['error4xx', 'error5xx', 'timeout'] as const).map((k) => (
              <tr key={k} className="border-b border-line">
                <td className="px-4 py-2.5 text-ink2">{k === 'error4xx' ? 'Lỗi 4xx' : k === 'error5xx' ? 'Lỗi 5xx (gồm timeout)' : 'Timeout backend (504)'}</td>
                {counts.map(({ region, c }) => (
                  <td key={region} className="px-4 py-2.5 text-right font-semibold text-ink">
                    <CountCell count={c ? c[k] : null} total={c?.requests ?? null} />
                  </td>
                ))}
              </tr>
            ))}
            {ERROR_CLASSES.map((cls) => (
              <tr key={cls} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5" title={ERROR_CLASS_INFO[cls].detail}>
                  <ErrorClassTag errorClass={cls} />
                </td>
                {counts.map(({ region, c }) => (
                  <td key={region} className="px-4 py-2.5 text-right font-semibold text-ink">
                    <CountCell count={c?.classes ? c.classes[cls] : null} total={c?.requests ?? null} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ErrorTypesTable({ snapshot }: { snapshot: MonitoringSnapshot }) {
  const types = snapshot.report?.errorTypes;
  return (
    <Card className="p-0">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">Loại lỗi thường gặp</h2>
        <p className="mt-0.5 text-xs text-ink2">Nhóm theo loại lỗi, mã lỗi, HTTP status và Region; tối đa 50 dòng.</p>
      </div>
      {types === undefined ? (
        <p className="px-4 py-3 text-sm text-ink2">
          <NotAvailable /> Backend chưa trả danh sách loại lỗi (cần /api/report định dạng mới).
        </p>
      ) : types.length === 0 ? (
        <p className="px-4 py-3 text-sm text-ink2">Không có request lỗi nào trong khoảng đang xem.</p>
      ) : (
        <div className="max-h-96 overflow-auto">
          <table aria-label="Loại lỗi thường gặp" className="w-full min-w-[40rem] text-left text-sm">
            <thead className="sticky top-0 bg-surface text-xs text-ink2">
              <tr className="border-b border-line">
                <th className="px-4 py-2 font-medium">Phân loại</th>
                <th className="px-4 py-2 font-medium">Mã lỗi</th>
                <th className="px-4 py-2 text-right font-medium">HTTP</th>
                <th className="px-4 py-2 font-medium">Region</th>
                <th className="px-4 py-2 text-right font-medium">Số lần</th>
                <th className="px-4 py-2 font-medium">Gần nhất</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {types.map((e) => (
                <tr key={`${e.errorClass}|${e.errorType}|${e.status}|${e.region}`} className="border-b border-line last:border-0">
                  <td className="px-4 py-2" title={ERROR_CLASS_INFO[e.errorClass].detail}>
                    <ErrorClassTag errorClass={e.errorClass} />
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-ink">{e.errorType ?? '—'}</td>
                  <td className="px-4 py-2 text-right text-ink">{e.status}</td>
                  <td className="px-4 py-2 text-ink2">{regionName(e.region)}</td>
                  <td className="px-4 py-2 text-right font-semibold text-ink">{formatNumber(e.count)}</td>
                  <td className="px-4 py-2 text-xs text-ink2">{formatDateTime(e.lastSeen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function ErrorsByKeyTable({ snapshot }: { snapshot: MonitoringSnapshot }) {
  const keys = snapshot.report?.errorsByKey;
  return (
    <Card className="p-0">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">Tỷ lệ lỗi theo API key</h2>
        <p className="mt-0.5 text-xs text-ink2">Chỉ liệt kê key có request trong khoảng đang xem, sắp theo số lỗi. Request không ghi nhận key không có trong bảng này.</p>
      </div>
      {keys === undefined ? (
        <p className="px-4 py-3 text-sm text-ink2">
          <NotAvailable /> Backend chưa trả lỗi theo API key (cần /api/report định dạng mới).
        </p>
      ) : keys.length === 0 ? (
        <p className="px-4 py-3 text-sm text-ink2">Chưa có request nào trong khoảng đang xem.</p>
      ) : (
        <div className="overflow-x-auto">
          <table aria-label="Tỷ lệ lỗi theo API key" className="w-full min-w-[40rem] text-left text-sm">
            <thead className="text-xs text-ink2">
              <tr className="border-b border-line">
                <th className="px-4 py-2 font-medium">API key</th>
                <th className="px-4 py-2 text-right font-medium">Request</th>
                <th className="px-4 py-2 text-right font-medium">4xx</th>
                <th className="px-4 py-2 text-right font-medium">5xx</th>
                <th className="px-4 py-2 text-right font-medium">Timeout</th>
                <th className="px-4 py-2 text-right font-medium">Tỷ lệ lỗi</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {keys.map((k) => (
                <tr key={k.keyId} className="border-b border-line last:border-0">
                  <td className="px-4 py-2">
                    <div className="text-ink">{k.name ?? 'Key đã xóa'}</div>
                    <div className="font-mono text-xs text-ink2">
                      {k.keyId}
                      {k.status === 'revoked' && ' · đã thu hồi'}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right text-ink">{formatNumber(k.requests)}</td>
                  <td className="px-4 py-2 text-right text-ink">{formatNumber(k.error4xx)}</td>
                  <td className="px-4 py-2 text-right text-ink">{formatNumber(k.error5xx)}</td>
                  <td className="px-4 py-2 text-right text-ink">{formatNumber(k.timeout)}</td>
                  <td className="px-4 py-2 text-right font-semibold text-ink">{k.errorRatePct === null ? <NotAvailable /> : formatPct(k.errorRatePct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function ErrorsContent({ snapshot, region }: { snapshot: MonitoringSnapshot; region: RegionFilter }) {
  const codes = REGIONS.map((r) => r.code).filter((c) => region === 'all' || c === region);
  const withTimeout = seriesHasTimeout(snapshot.series);
  const partial = partialTimes(snapshot.series);
  const mockTag = snapshot.dataMode === 'mock' ? <Tag tone="warning">Mock data</Tag> : undefined;
  const scope = region === 'all' ? 'cả hai Region' : regionName(region);
  const errorRows = snapshot.series.map((p) => errorSplitRow(p, codes, withTimeout)) as ChartRow[];
  const errorSeries = [
    { key: 'error4xx', name: '4xx (phía client)', color: 'var(--error-4xx)' },
    { key: 'error5xx', name: withTimeout ? '5xx (trừ timeout)' : '5xx', color: 'var(--error-5xx)' },
    ...(withTimeout ? [{ key: 'timeout', name: 'Timeout (504)', color: 'var(--error-timeout)' }] : []),
  ];
  const timeoutRows = snapshot.series.map((p) => ({ t: p.t, ...Object.fromEntries(codes.map((c) => [c, timeoutPoint(p.regions[c])])) })) as ChartRow[];
  const timeoutSeries = codes.map((c) => ({ key: c, name: regionName(c), color: REGION_COLOR[c] }));

  return (
    <div className="space-y-4">
      <p className="rounded-xl border border-line bg-raised px-4 py-3 text-xs text-ink2">
        Chỉ gồm request đã vào được proxy của gateway (có telemetry). Lỗi do API Gateway trả trước khi vào proxy (401/403 key sai hoặc bị thu hồi, 429 throttle, Lambda bị giới hạn) không
        có ở đây, nên tỷ lệ lỗi thực tế có thể cao hơn khi nền tảng quá tải.
      </p>
      <ErrorsByRegion snapshot={snapshot} codes={codes} />
      <div className="grid gap-4 xl:grid-cols-2">
        <TimeChart
          kind="stacked-bar"
          title="4xx và 5xx theo thời gian"
          subtitle={`Số request lỗi mỗi ô ${RANGES[snapshot.range].bucketMs / 60_000} phút, ${scope}.`}
          rows={errorRows}
          series={errorSeries}
          range={snapshot.range}
          format={formatNumber}
          badge={mockTag}
          partial={partial}
        />
        {withTimeout ? (
          <TimeChart
            kind="line"
            title="Timeout theo thời gian"
            subtitle="Số request hết thời gian chờ backend (504) mỗi ô."
            rows={timeoutRows}
            series={timeoutSeries}
            range={snapshot.range}
            format={formatNumber}
            badge={mockTag}
            partial={partial}
          />
        ) : (
          <Card>
            <h2 className="text-sm font-semibold text-ink">Timeout theo thời gian</h2>
            <div className="mt-3">
              <EmptyState title="N/A">Backend chưa trả số timeout theo ô thời gian. Timeout đang nằm chung trong cột 5xx.</EmptyState>
            </div>
          </Card>
        )}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <ErrorTypesTable snapshot={snapshot} />
        <ErrorsByKeyTable snapshot={snapshot} />
      </div>
    </div>
  );
}

export function ErrorsPage() {
  const query = useSnapshot();
  const { settings } = useSettings();
  return (
    <>
      <PageHeader
        title="Lỗi & timeout"
        description="Lỗi của traffic doanh nghiệp bạn theo Region, loại lỗi và API key. 4xx (phía client, cấu hình) tách khỏi 5xx và timeout của backend."
        actions={<DataToolbar region updatedAt={query.data?.generatedAt ?? null} onRefresh={() => void query.refetch()} fetching={query.isFetching} />}
      />
      <QueryBoundary query={query}>{(snapshot) => <ErrorsContent snapshot={snapshot} region={settings.region} />}</QueryBoundary>
    </>
  );
}
