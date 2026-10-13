import { ArrowRight } from 'lucide-react';
import { useSnapshot } from '../app/data';
import { type ChartRow, TimeChart } from '../components/charts';
import { DataToolbar } from '../components/Toolbar';
import { Card, HealthBadge, KpiCard, MetricText, PageHeader, QueryBoundary, Tag } from '../components/ui';
import { formatMs, formatNumber, formatPct } from '../domain/format';
import { RANGES } from '../domain/range';
import { deriveRegionHealth, deriveReplicationHealth, maxMetric, sumMetrics, weightedAverage } from '../domain/status';
import { type Metric, type MonitoringSnapshot, regionName, type RegionSnapshot, REGIONS } from '../domain/types';

const REGION_SERIES = [
  { key: 'ap-southeast-1', name: 'Singapore', color: 'var(--series-1)' },
  { key: 'ap-northeast-1', name: 'Tokyo', color: 'var(--series-2)' },
];
const ERROR_SERIES = [
  { key: 'error4xx', name: '4xx', color: 'var(--error-4xx)' },
  { key: 'error5xx', name: '5xx', color: 'var(--error-5xx)' },
];

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
      <dl className="mt-4 grid grid-cols-3 gap-2 text-xs text-ink2">
        <div>
          <dt>Request</dt>
          <dd className="mt-0.5 text-base font-semibold text-ink">
            <MetricText metric={region.requests} format={formatNumber} />
          </dd>
        </div>
        <div>
          <dt>Error rate</dt>
          <dd className="mt-0.5 text-base font-semibold text-ink">
            <MetricText metric={region.errorRatePct} format={formatPct} />
          </dd>
        </div>
        <div>
          <dt>Latency p95</dt>
          <dd className="mt-0.5 text-base font-semibold text-ink">
            <MetricText metric={region.latencyP95Ms} format={formatMs} />
          </dd>
        </div>
      </dl>
    </Card>
  );
}

function ReplicationCard({ snapshot }: { snapshot: MonitoringSnapshot }) {
  return (
    <Card>
      <h2 className="text-sm font-semibold text-ink">Replication giữa các Region</h2>
      <p className="mt-0.5 text-xs text-ink2">DynamoDB Global Tables, độ trễ theo từng chiều.</p>
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
                <HealthBadge health={deriveReplicationHealth(r.dynamodbReplicationLatencyMs)} />
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-ink2">
        S3 replication:{' '}
        <span className="font-medium text-ink">
          <MetricText metric={snapshot.regions[0].s3ReplicationLatencyS} format={(n) => `${n.toFixed(1)} s`} />
        </span>
      </p>
    </Card>
  );
}

function RoutingCard({ snapshot }: { snapshot: MonitoringSnapshot }) {
  return (
    <Card>
      <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
        Định tuyến và failover
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
              <span className="w-24 shrink-0">Tỷ lệ traffic</span>
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

function OverviewContent({ snapshot }: { snapshot: MonitoringSnapshot }) {
  const { regions } = snapshot;
  const requests = sumMetrics(regions.map((r) => r.requests));
  const weightBy = (pick: (r: RegionSnapshot) => RegionSnapshot['requests']) => weightedAverage(regions.map((r) => ({ metric: pick(r), weight: r.requests })));

  const requestRows: ChartRow[] = snapshot.series.map((p) => ({
    t: p.t,
    'ap-southeast-1': p.regions['ap-southeast-1'].requests,
    'ap-northeast-1': p.regions['ap-northeast-1'].requests,
  }));
  const errorRows: ChartRow[] = snapshot.series.map((p) => {
    const all = Object.values(p.regions);
    return { t: p.t, error4xx: all.reduce((s, b) => s + b.error4xx, 0), error5xx: all.reduce((s, b) => s + b.error5xx, 0) };
  });
  const successPct = weightBy((r) => r.successRatePct);
  const errorPct = weightBy((r) => r.errorRatePct);
  const mockTag = snapshot.dataMode === 'mock' ? <Tag tone="warning">Mock data</Tag> : undefined;
  const bucket = `Mỗi điểm là một ô ${RANGES[snapshot.range].bucketMs / 60_000} phút.`;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {regions.map((r) => (
          <RegionCard key={r.region} region={r} />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <KpiCard label="Tổng request" metric={requests} format={formatNumber} hint={`Trong ${RANGES[snapshot.range].label} qua, cả hai Region`} />
        <KpiCard label="Tỷ lệ thành công" metric={successPct} format={formatPct} />
        <KpiCard label="Tỷ lệ lỗi" metric={errorPct} format={formatPct} hint="Gồm 4xx và 5xx" />
        <KpiCard label="Latency trung bình" metric={weightBy((r) => r.latencyAvgMs)} format={formatMs} />
        <KpiCard label="Latency p95" metric={maxMetric(regions.map((r) => r.latencyP95Ms))} format={formatMs} hint="Region có p95 cao hơn" />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <TimeChart kind="line" title="Request theo thời gian" subtitle={bucket} rows={requestRows} series={REGION_SERIES} range={snapshot.range} badge={mockTag} />
        <TimeChart
          kind="stacked-bar"
          title="Success và error"
          subtitle={`Cột là số request lỗi của cả hai Region. ${bucket}`}
          rows={errorRows}
          series={ERROR_SERIES}
          range={snapshot.range}
          format={formatNumber}
          badge={mockTag}
          lead={<OutcomeSplit successPct={successPct} errorPct={errorPct} />}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ReplicationCard snapshot={snapshot} />
        <RoutingCard snapshot={snapshot} />
      </div>
    </div>
  );
}

export function OverviewPage() {
  const query = useSnapshot();
  return (
    <>
      <PageHeader
        title="System Overview"
        description="Tình trạng chung của nền tảng trên hai Region."
        actions={<DataToolbar updatedAt={query.data?.generatedAt ?? null} onRefresh={() => void query.refetch()} fetching={query.isFetching} />}
      />
      <QueryBoundary query={query}>{(snapshot) => <OverviewContent snapshot={snapshot} />}</QueryBoundary>
    </>
  );
}
