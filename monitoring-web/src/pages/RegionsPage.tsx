import { useState } from 'react';
import { useSnapshot } from '../app/data';
import { type RegionView, useSettings } from '../app/settings';
import { type ChartRow, TimeChart } from '../components/charts';
import { DataToolbar } from '../components/Toolbar';
import { Card, HealthBadge, MetricText, PageHeader, QueryBoundary, Tag } from '../components/ui';
import { formatMs, formatNumber, formatPct } from '../domain/format';
import { deriveRegionHealth, deriveReplicationHealth } from '../domain/status';
import { type Metric, type MonitoringSnapshot, regionName, type RegionSnapshot, REGIONS } from '../domain/types';

const seconds = (n: number) => `${n.toFixed(1)} s`;

const ROWS: { group: string; label: string; pick: (r: RegionSnapshot) => Metric; format: (n: number) => string }[] = [
  { group: 'Tổng quan', label: 'Số request', pick: (r) => r.requests, format: formatNumber },
  { group: 'Tổng quan', label: 'Error rate', pick: (r) => r.errorRatePct, format: formatPct },
  { group: 'Tổng quan', label: 'Latency trung bình', pick: (r) => r.latencyAvgMs, format: formatMs },
  { group: 'Tổng quan', label: 'Latency p95', pick: (r) => r.latencyP95Ms, format: formatMs },
  { group: 'AWS Lambda', label: 'Invocations', pick: (r) => r.lambda.invocations, format: formatNumber },
  { group: 'AWS Lambda', label: 'Errors', pick: (r) => r.lambda.errors, format: formatNumber },
  { group: 'AWS Lambda', label: 'Duration trung bình', pick: (r) => r.lambda.durationAvgMs, format: formatMs },
  { group: 'API Gateway', label: 'Request', pick: (r) => r.apiGateway.requests, format: formatNumber },
  { group: 'API Gateway', label: '4xx', pick: (r) => r.apiGateway.error4xx, format: formatNumber },
  { group: 'API Gateway', label: '5xx', pick: (r) => r.apiGateway.error5xx, format: formatNumber },
  { group: 'Replication', label: 'DynamoDB replication lag (gửi đi)', pick: (r) => r.dynamodbReplicationLatencyMs, format: formatMs },
  { group: 'Replication', label: 'S3 replication lag (gửi đi)', pick: (r) => r.s3ReplicationLatencyS, format: seconds },
  { group: 'Định tuyến', label: 'Tỷ lệ traffic đang nhận', pick: (r) => r.trafficSharePct, format: (n) => `${n.toFixed(0)}%` },
];

function healthCheckLabel(r: RegionSnapshot): string {
  if (r.healthCheck.kind === 'missing') return 'Unknown';
  return r.healthCheck.value === 'healthy' ? 'Healthy' : 'Unhealthy';
}

function RegionTable({ regions }: { regions: RegionSnapshot[] }) {
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full min-w-[32rem] text-left text-sm">
        <thead className="text-xs text-ink2">
          <tr className="border-b border-line">
            <th className="px-4 py-3 font-medium">Metric</th>
            {regions.map((r) => (
              <th key={r.region} className="px-4 py-3 text-right font-medium">
                <div className="text-sm font-semibold text-ink">{regionName(r.region)}</div>
                <div>{r.region}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-line">
            <td className="px-4 py-2.5 text-ink2">Trạng thái hoạt động</td>
            {regions.map((r) => (
              <td key={r.region} className="px-4 py-2.5 text-right">
                <HealthBadge health={deriveRegionHealth(r)} />
              </td>
            ))}
          </tr>
          <tr className="border-b border-line">
            <td className="px-4 py-2.5 text-ink2">Route 53 health check</td>
            {regions.map((r) => (
              <td key={r.region} className="px-4 py-2.5 text-right">
                <HealthBadge health={r.healthCheck.kind === 'missing' ? 'unknown' : r.healthCheck.value === 'healthy' ? 'healthy' : 'down'} label={healthCheckLabel(r)} />
              </td>
            ))}
          </tr>
          {ROWS.map((row, i) => (
            <tr key={row.label} className="border-b border-line last:border-0">
              <td className="px-4 py-2.5 text-ink2">
                {(i === 0 || ROWS[i - 1].group !== row.group) && <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{row.group}</div>}
                {row.label}
              </td>
              {regions.map((r) => (
                <td key={r.region} className="px-4 py-2.5 text-right align-bottom font-semibold tabular-nums text-ink">
                  <MetricText metric={row.pick(r)} format={row.format} />
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <td className="px-4 py-2.5 text-ink2">Tình trạng replication DynamoDB</td>
            {regions.map((r) => (
              <td key={r.region} className="px-4 py-2.5 text-right">
                <HealthBadge health={deriveReplicationHealth(r.dynamodbReplicationLatencyMs)} />
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </Card>
  );
}

function RegionsContent({ snapshot, view }: { snapshot: MonitoringSnapshot; view: RegionView }) {
  const regions = view === 'compare' ? snapshot.regions : snapshot.regions.filter((r) => r.region === view);
  const shown = REGIONS.filter((r) => view === 'compare' || r.code === view);
  // Màu đi theo Region, không theo vị trí: lọc còn một Region thì Region đó vẫn giữ màu cũ.
  const series = shown.map((r) => ({ key: r.code, name: r.name, color: r.code === 'ap-southeast-1' ? 'var(--series-1)' : 'var(--series-2)' }));
  const rowsOf = (pick: (b: MonitoringSnapshot['series'][number]['regions'][RegionSnapshot['region']]) => number): ChartRow[] =>
    snapshot.series.map((p) => ({ t: p.t, ...Object.fromEntries(shown.map((r) => [r.code, pick(p.regions[r.code])])) }) as ChartRow);
  const mockTag = snapshot.dataMode === 'mock' ? <Tag tone="warning">Mock data</Tag> : undefined;

  return (
    <div className="space-y-4">
      <RegionTable regions={regions} />
      <div className="grid gap-4 xl:grid-cols-2">
        <TimeChart kind="line" title="Latency p95" rows={rowsOf((b) => b.latencyP95Ms)} series={series} range={snapshot.range} format={formatMs} badge={mockTag} />
        <TimeChart
          kind="line"
          title="Error rate"
          subtitle="Tỷ lệ request trả 4xx hoặc 5xx trong mỗi ô thời gian."
          rows={rowsOf((b) => (b.requests ? ((b.error4xx + b.error5xx) / b.requests) * 100 : 0))}
          series={series}
          range={snapshot.range}
          format={formatPct}
          badge={mockTag}
        />
      </div>
    </div>
  );
}

export function RegionsPage() {
  const query = useSnapshot();
  const { settings } = useSettings();
  const [view, setView] = useState<RegionView>(settings.defaultRegion);
  const options: { value: RegionView; label: string }[] = [{ value: 'compare', label: 'So sánh' }, ...REGIONS.map((r) => ({ value: r.code, label: r.name }))];

  return (
    <>
      <PageHeader
        title="Multi-Region Monitoring"
        description="Số liệu chi tiết của từng Region và so sánh Singapore với Tokyo."
        actions={<DataToolbar updatedAt={query.data?.generatedAt ?? null} onRefresh={() => void query.refetch()} fetching={query.isFetching} />}
      />
      <div role="group" aria-label="Chọn Region" className="mb-4 inline-flex rounded-md border border-line bg-surface p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={view === o.value}
            onClick={() => setView(o.value)}
            className={`rounded px-3 py-1.5 text-sm ${view === o.value ? 'bg-raised font-semibold text-ink' : 'text-ink2 hover:text-ink'}`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <QueryBoundary query={query}>{(snapshot) => <RegionsContent snapshot={snapshot} view={view} />}</QueryBoundary>
    </>
  );
}
