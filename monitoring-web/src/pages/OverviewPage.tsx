import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { useSnapshot } from '../app/data';
import { useSettings } from '../app/settings';
import { type ChartRow, TimeChart } from '../components/charts';
import { LatencyBreakdownCard } from '../components/LatencyBreakdown';
import { DataToolbar } from '../components/Toolbar';
import { Card, HealthBadge, KpiCard, MetricText, OptionalMetric, PageHeader, QueryBoundary, Tag } from '../components/ui';
import { formatDateTime, formatMs, formatNumber, formatPct } from '../domain/format';
import { RANGES } from '../domain/range';
import { errorSplitRow, overviewTotals, partialTimes, requestPoint, seriesHasTimeout } from '../domain/report';
import { currentReplicationHealth, deriveRegionHealth, replicationFreshness } from '../domain/status';
import { type Metric, type MonitoringSnapshot, type RegionFilter, regionName, type RegionSnapshot, REGIONS } from '../domain/types';

const REGION_SERIES = [
  { key: 'ap-southeast-1', name: 'Singapore', color: 'var(--series-1)' },
  { key: 'ap-northeast-1', name: 'Tokyo', color: 'var(--series-2)' },
];
const ERROR_SERIES = [
  { key: 'error4xx', name: '4xx', color: 'var(--error-4xx)' },
  { key: 'error5xx', name: '5xx', color: 'var(--error-5xx)' },
];
// Khi backend có trường timeout: tách timeout khỏi 5xx còn lại để không lẫn backend chậm với lỗi khác.
const ERROR_SERIES_TIMEOUT = [
  { key: 'error4xx', name: '4xx', color: 'var(--error-4xx)' },
  { key: 'error5xx', name: '5xx (trừ timeout)', color: 'var(--error-5xx)' },
  { key: 'timeout', name: 'Timeout (504)', color: 'var(--error-timeout)' },
];
export const HEALTH_NOTE = 'Health phản ánh Route 53 health check và lỗi hạ tầng của gateway, không phải tỷ lệ request thành công: 4xx, backend chậm hay backend trả 5xx không làm Region Degraded.';

// Tỷ lệ success/error của cả khoảng xem. Lỗi chỉ chiếm vài phần trăm nên luôn kèm con số.
function OutcomeSplit({ successPct, errorPct }: { successPct: Metric; errorPct: Metric }) {
  return (
    <div className="mt-3">
      <div className="flex justify-between text-xs text-ink2">
        <span>
          Thành công{' '}
          <span className="font-semibold text-ink">
            <MetricText metric={successPct} format={formatPct} />
          </span>
        </span>
        <span>
          Lỗi{' '}
          <span className="font-semibold text-ink">
            <MetricText metric={errorPct} format={formatPct} />
          </span>
        </span>
      </div>
      {errorPct.kind === 'value' && (
        <div className="mt-1 flex h-2 justify-end overflow-hidden rounded-full bg-raised" aria-hidden>
          <span className="h-full rounded-full" style={{ width: `${Math.max(errorPct.value, 1)}%`, background: 'var(--error-5xx)' }} />
        </div>
      )}
    </div>
  );
}

function CardStat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className="mt-0.5 text-base font-semibold tabular-nums text-ink">{children}</dd>
    </div>
  );
}

// Thẻ Region: số liệu traffic của doanh nghiệp. Trường nào backend không trả thì hiện N/A, không hiện 0.
function RegionCard({ region }: { region: RegionSnapshot }) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-ink">{regionName(region.region)}</div>
          <div className="text-xs text-ink2">{region.region}</div>
        </div>
        <HealthBadge health={deriveRegionHealth(region)} />
      </div>
      <dl role="group" className="mt-4 grid grid-cols-2 gap-x-2 gap-y-3 text-xs text-ink2 sm:grid-cols-4" aria-label={`Số liệu ${regionName(region.region)}`}>
        <CardStat label="Request">
          <MetricText metric={region.requests} format={formatNumber} />
        </CardStat>
        <CardStat label="Thành công">
          <MetricText metric={region.successRatePct} format={formatPct} />
        </CardStat>
        <CardStat label="Tỷ lệ 4xx">
          <OptionalMetric metric={region.error4xxRatePct} format={formatPct} />
        </CardStat>
        <CardStat label="Tỷ lệ 5xx">
          <OptionalMetric metric={region.error5xxRatePct ?? region.serverErrorRatePct} format={formatPct} />
        </CardStat>
        <CardStat label="Latency avg">
          <MetricText metric={region.latencyAvgMs} format={formatMs} />
        </CardStat>
        <CardStat label="Latency p95">
          <MetricText metric={region.latencyP95Ms} format={formatMs} />
        </CardStat>
        <CardStat label="Latency p99">
          <OptionalMetric metric={region.latencyP99Ms} format={formatMs} />
        </CardStat>
        <CardStat label="Timeout">
          <OptionalMetric metric={region.timeouts} format={formatNumber} />
        </CardStat>
      </dl>
    </Card>
  );
}

function ReplicationEvidence({ metric, observedAt }: { metric: Metric; observedAt?: number | null }) {
  const freshness = replicationFreshness(metric, observedAt);
  return <span className="block text-xs text-ink2">{observedAt != null ? `Mẫu gần nhất: ${formatDateTime(observedAt)}. ` : 'Chưa có thời điểm đo. '}{freshness === 'stale' ? 'Dữ liệu cũ (>1 giờ hoặc thời điểm không hợp lệ), chưa xác minh trạng thái hiện tại.' : freshness === 'missing' ? 'Chưa có dữ liệu mới để xác minh trạng thái hiện tại.' : 'Có mẫu trong 1 giờ qua.'}</span>;
}

function ReplicationCard({ snapshot }: { snapshot: MonitoringSnapshot }) {
  return (
    <Card>
      <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
        Replication giữa các Region <Tag>Dùng chung</Tag>
      </h2>
      <p className="mt-0.5 text-xs text-ink2">DynamoDB Global Tables, độ trễ trung bình trong khoảng đang xem theo từng chiều. Chỉ xác định trạng thái khi có mẫu trong 1 giờ qua; không có mẫu có thể do chưa phát sinh ghi. Hạ tầng chung, không theo API key.</p>
      <ul className="mt-3 space-y-2">
        {snapshot.regions.map((r) => {
          const target = REGIONS.find((x) => x.code !== r.region)!;
          return (
            <li key={r.region} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line px-3 py-2 text-sm">
              <span className="flex items-center gap-1.5 text-ink">
                {regionName(r.region)} <ArrowRight aria-hidden className="size-3.5 text-muted" /> {target.name}
              </span>
              <span className="flex items-center gap-2">
                <span className="font-semibold text-ink">
                  <MetricText metric={r.dynamodbReplicationLatencyMs} format={formatMs} />
                </span>
                <HealthBadge health={currentReplicationHealth(r.dynamodbReplicationLatencyMs, r.dynamodbReplicationObservedAt)} />
              </span>
              <ReplicationEvidence metric={r.dynamodbReplicationLatencyMs} observedAt={r.dynamodbReplicationObservedAt} />
            </li>
          );
        })}
      </ul>
      <div className="mt-3 space-y-2 text-xs text-ink2">
        {snapshot.regions.map((r) => <div key={r.region}>S3 replication từ {regionName(r.region)} (lớn nhất trong khoảng xem): <MetricText metric={r.s3ReplicationLatencyS} format={(n) => `${n.toFixed(1)} s`} /><ReplicationEvidence metric={r.s3ReplicationLatencyS} observedAt={r.s3ReplicationObservedAt} /></div>)}
      </div>
    </Card>
  );
}

function RoutingCard({ snapshot }: { snapshot: MonitoringSnapshot }) {
  return (
    <Card>
      <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
        Định tuyến và failover
        <Tag>Dùng chung</Tag>
        {snapshot.dataMode === 'mock' && <Tag tone="warning">Mô phỏng</Tag>}
      </h2>
      <p className="mt-0.5 text-xs text-ink2">
        Chính sách:{' '}
        <span className="font-medium text-ink">{snapshot.routingPolicy.kind === 'value' ? snapshot.routingPolicy.value : <MetricText metric={snapshot.routingPolicy} format={String} />}</span>
      </p>
      <ul className="mt-3 space-y-2">
        {snapshot.regions.map((r) => (
          <li key={r.region} className="rounded-md border border-line px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-ink">{regionName(r.region)}</span>
              <HealthBadge
                health={r.healthCheck.kind === 'missing' ? 'unknown' : r.healthCheck.value === 'healthy' ? 'healthy' : 'down'}
                label={r.healthCheck.kind === 'missing' ? 'Health check: Unknown' : `Health check: ${r.healthCheck.value === 'healthy' ? 'Healthy' : 'Unhealthy'}`}
              />
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs text-ink2">
              <span className="w-28 shrink-0">Traffic của bạn</span>
              {r.trafficSharePct.kind === 'value' ? (
                <>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised">
                    <span className="block h-full rounded-full bg-accent" style={{ width: `${r.trafficSharePct.value}%` }} />
                  </span>
                  <span className="w-12 text-right font-semibold text-ink">{r.trafficSharePct.value.toFixed(0)}%</span>
                </>
              ) : (
                <MetricText metric={r.trafficSharePct} format={formatPct} />
              )}
            </div>
          </li>
        ))}
      </ul>
      {snapshot.dataMode === 'mock' && <p className="mt-3 text-xs text-ink2">Trạng thái này là mô phỏng. Nó không chứng minh Route 53 đã định tuyến hay failover thành công.</p>}
    </Card>
  );
}

function OverviewContent({ snapshot, region }: { snapshot: MonitoringSnapshot; region: RegionFilter }) {
  const { regions } = snapshot;
  const kpi = overviewTotals(snapshot, region);
  const requests = kpi.requests;
  const scope = region === 'all' ? 'cả hai Region' : regionName(region);

  const requestRows: ChartRow[] = snapshot.series.map((p) => ({
    t: p.t,
    'ap-southeast-1': requestPoint(p.regions['ap-southeast-1']),
    'ap-northeast-1': requestPoint(p.regions['ap-northeast-1']),
  }));
  const withTimeout = seriesHasTimeout(snapshot.series);
  const errorRows = snapshot.series.map((p) => errorSplitRow(p, REGIONS.map((r) => r.code), withTimeout)) as ChartRow[];
  const partial = partialTimes(snapshot.series);
  const successPct = kpi.successPct;
  const errorPct = kpi.errorPct;
  const mockTag = snapshot.dataMode === 'mock' ? <Tag tone="warning">Mock data</Tag> : undefined;
  const bucket = `Mỗi điểm là một ô ${RANGES[snapshot.range].bucketMs / 60_000} phút.`;
  const totals = snapshot.report?.totals;
  const breakdownGroups = [
    ...(totals ? [{ label: `Tổng (${scope})`, latency: totals.latency, breakdown: totals.breakdown }] : []),
    ...regions.map((r) => ({ label: regionName(r.region), latency: r.traffic?.latency, breakdown: r.latencyBreakdown })),
  ];
  const p95Label = kpi.p95.upperBound ? 'Latency p95 (cận trên)' : 'Latency p95';
  const p95Hint = kpi.p95.upperBound
    ? 'Backend chưa trả p95 gộp: đây là max p95 của các Region, luôn ≥ p95 thật của toàn bộ request. Không phải p95 thật.'
    : kpi.pooled
      ? 'p95 trên mẫu gộp của mọi request trong phạm vi đang xem. Gồm thời gian backend của bạn xử lý; không dùng để xác định Region hỏng.'
      : 'Gồm thời gian backend của bạn xử lý; không dùng để xác định Region hỏng';

  const noTraffic = requests.kind === 'value' && requests.value === 0;

  return (
    <div className="space-y-4">
      {noTraffic && (
        <p role="status" className="rounded-xl border border-line bg-raised px-4 py-3 text-sm text-ink">
          Chưa có request nào qua API key đang chọn trong {RANGES[snapshot.range].label} qua. Key mới tạo sẽ hiện 0 cho tới khi bạn gọi API qua gateway. Số liệu Lambda, API Gateway toàn
          stage ở trang Multi-Region là hạ tầng dùng chung (gồm Route 53 health check), không phải lưu lượng của key bạn.
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {regions.map((r) => (
          <RegionCard key={r.region} region={r} />
        ))}
      </div>
      <p className="text-xs text-ink2">{HEALTH_NOTE}</p>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <KpiCard
          label="Tổng request"
          metric={requests}
          format={formatNumber}
          hint={`Request của doanh nghiệp bạn (theo API key đang chọn) tới /proxy trong ${RANGES[snapshot.range].label} qua, ${scope}. Không gồm health check, portal, dashboard.`}
        />
        <KpiCard label="Tỷ lệ thành công" metric={successPct} format={formatPct} />
        <KpiCard label="Tỷ lệ lỗi" metric={errorPct} format={formatPct} hint="Gồm 4xx và 5xx" />
        <KpiCard label="Latency trung bình" metric={kpi.avgMs} format={formatMs} />
        <KpiCard label={p95Label} metric={kpi.p95.metric} format={formatMs} prefix={kpi.p95.upperBound ? '≤' : undefined} hint={p95Hint} />
        <KpiCard
          label={kpi.p99?.upperBound ? 'Latency p99 (cận trên)' : 'Latency p99'}
          metric={kpi.p99?.metric}
          format={formatMs}
          prefix={kpi.p99?.upperBound ? '≤' : undefined}
          hint={kpi.p99 ? (kpi.p99.upperBound ? 'Max p99 của các Region, không phải p99 thật.' : undefined) : 'Backend chưa trả p99.'}
        />
      </div>
      {snapshot.report?.window && (
        <p className="text-xs text-ink2">
          Cửa sổ dữ liệu thực tế: {formatDateTime(snapshot.report.window.startMs)} – {formatDateTime(snapshot.report.window.endMs)} (căn theo ô{' '}
          {snapshot.report.window.bucketMs / 60_000} phút, nên có thể ngắn hơn {RANGES[snapshot.range].label} một chút).
        </p>
      )}
      {region !== 'all' && (
        <p className="text-xs text-ink2">
          KPI tổng ở trên chỉ tính request do {regionName(region)} phục vụ. Thẻ Region và biểu đồ theo thời gian luôn hiện đủ hai Region.
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <TimeChart
          kind="line"
          title="Request theo thời gian"
          subtitle={`${bucket} Số 0 là 0 request thật (mọi request vào gateway đều được ghi).`}
          rows={requestRows}
          series={REGION_SERIES}
          range={snapshot.range}
          badge={mockTag}
          partial={partial}
        />
        <TimeChart
          kind="stacked-bar"
          title="Success và error"
          subtitle={`Cột là số request lỗi của cả hai Region. ${bucket}`}
          rows={errorRows}
          series={withTimeout ? ERROR_SERIES_TIMEOUT : ERROR_SERIES}
          range={snapshot.range}
          format={formatNumber}
          badge={mockTag}
          partial={partial}
          lead={<OutcomeSplit successPct={successPct} errorPct={errorPct} />}
        />
      </div>

      <LatencyBreakdownCard groups={breakdownGroups} badge={mockTag} />

      <div className="grid gap-4 md:grid-cols-2">
        <ReplicationCard snapshot={snapshot} />
        <RoutingCard snapshot={snapshot} />
      </div>
    </div>
  );
}

export function OverviewPage() {
  const query = useSnapshot();
  const { settings } = useSettings();
  return (
    <>
      <PageHeader
        title="System Overview"
        description="Traffic của doanh nghiệp bạn trên hai Region, lọc được theo từng API key. Thẻ gắn nhãn Dùng chung (health check, định tuyến, replication) là hạ tầng chung của cả hệ thống, không theo key."
        actions={<DataToolbar region updatedAt={query.data?.generatedAt ?? null} onRefresh={() => void query.refetch()} fetching={query.isFetching} />}
      />
      <QueryBoundary query={query}>{(snapshot) => <OverviewContent snapshot={snapshot} region={settings.region} />}</QueryBoundary>
    </>
  );
}
