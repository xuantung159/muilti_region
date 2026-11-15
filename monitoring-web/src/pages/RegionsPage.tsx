import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { useProvider, useSnapshot } from '../app/data';
import { type RegionView, useSettings } from '../app/settings';
import { type ChartRow, TimeChart } from '../components/charts';
import { DataToolbar } from '../components/Toolbar';
import { Card, HealthBadge, MetricText, OptionalMetric, PageHeader, QueryBoundary, Tag } from '../components/ui';
import { formatDateTime, formatMs, formatNumber, formatPct } from '../domain/format';
import { errorRatePoint, latencyPoint, partialTimes } from '../domain/report';
import { currentReplicationHealth, deriveRegionHealth } from '../domain/status';
import { type Metric, type MonitoringSnapshot, regionName, type RegionSnapshot, REGIONS } from '../domain/types';
import { portalCall, readToken } from '../portal/client';

const seconds = (n: number) => `${n.toFixed(1)} s`;
const unavailable: Metric = { kind: 'missing', reason: 'unavailable' };

// pick trả undefined khi backend không có trường đó (trường tùy chọn) → hiện N/A.
type Row = { group: string; label: string; pick: (r: RegionSnapshot) => Metric | undefined; format: (n: number) => string };

// Phần còn lại của stage sau khi trừ health check và /proxy: portal (/api/*), dashboard (/monitoring/*)...
function otherStageRequests(r: RegionSnapshot): Metric {
  const { requests, healthCheckRequests: health, proxyRequests: proxy } = r.apiGateway;
  if (requests.kind !== 'value' || health?.kind !== 'value' || proxy?.kind !== 'value') return unavailable;
  return { kind: 'value', value: Math.max(0, requests.value - health.value - proxy.value) };
}

// Traffic của doanh nghiệp đang đăng nhập, theo API key đang chọn (telemetry GET /api/report).
const TENANT_ROWS: Row[] = [
  { group: 'Lưu lượng', label: 'Số request (API doanh nghiệp /proxy)', pick: (r) => r.requests, format: formatNumber },
  { group: 'Lưu lượng', label: 'Tỷ lệ traffic Region này phục vụ', pick: (r) => r.trafficSharePct, format: (n) => `${n.toFixed(0)}%` },
  { group: 'Lưu lượng', label: 'Tỷ lệ thành công (< 400)', pick: (r) => r.successRatePct, format: formatPct },
  { group: 'Lỗi', label: 'Error rate (4xx + 5xx)', pick: (r) => r.errorRatePct, format: formatPct },
  { group: 'Lỗi', label: 'Lỗi 4xx', pick: (r) => r.error4xxRatePct, format: formatPct },
  { group: 'Lỗi', label: 'Lỗi 5xx (tổng)', pick: (r) => r.serverErrorRatePct ?? unavailable, format: formatPct },
  { group: 'Lỗi', label: 'Lỗi gateway 5xx (dùng để xác định trạng thái)', pick: (r) => r.gatewayErrorRatePct ?? unavailable, format: formatPct },
  { group: 'Lỗi', label: 'Lỗi backend 5xx (502/504, backend tự trả 5xx)', pick: (r) => r.upstreamErrorRatePct ?? unavailable, format: formatPct },
  { group: 'Lỗi', label: 'Timeout backend (số request)', pick: (r) => r.timeouts, format: formatNumber },
  { group: 'Lỗi', label: 'Timeout rate', pick: (r) => r.timeoutRatePct, format: formatPct },
  { group: 'Độ trễ', label: 'Latency trung bình (gồm backend)', pick: (r) => r.latencyAvgMs, format: formatMs },
  { group: 'Độ trễ', label: 'Latency p50 (gồm backend)', pick: (r) => r.latencyP50Ms, format: formatMs },
  { group: 'Độ trễ', label: 'Latency p95 (gồm backend)', pick: (r) => r.latencyP95Ms, format: formatMs },
  { group: 'Độ trễ', label: 'Latency p99 (gồm backend)', pick: (r) => r.latencyP99Ms, format: formatMs },
];

export const COMPARISON_CAVEAT =
  'So sánh độ trễ giữa Singapore và Tokyo chỉ phản ánh traffic thực tế trong khoảng đang xem (vị trí client, backend, mạng tới backend khác nhau). Không đủ để kết luận về kiến trúc nếu chưa có thử nghiệm có kiểm soát (cùng client, cùng backend, cùng tải).';

// Hạ tầng dùng chung: CloudWatch của cả nền tảng, không lọc được theo doanh nghiệp hay API key.
const SHARED_ROWS: Row[] = [
  { group: 'AWS Lambda (mrapi-proxy)', label: 'Invocations (gồm /health của health check)', pick: (r) => r.lambda.invocations, format: formatNumber },
  { group: 'AWS Lambda (mrapi-proxy)', label: 'Errors', pick: (r) => r.lambda.errors, format: formatNumber },
  { group: 'AWS Lambda (mrapi-proxy)', label: 'Duration trung bình', pick: (r) => r.lambda.durationAvgMs, format: formatMs },
  { group: 'API Gateway (toàn stage)', label: 'Request toàn stage', pick: (r) => r.apiGateway.requests, format: formatNumber },
  { group: 'API Gateway (toàn stage)', label: '↳ Route 53 health check (GET /health)', pick: (r) => r.apiGateway.healthCheckRequests ?? unavailable, format: formatNumber },
  { group: 'API Gateway (toàn stage)', label: '↳ /proxy của mọi doanh nghiệp', pick: (r) => r.apiGateway.proxyRequests ?? unavailable, format: formatNumber },
  { group: 'API Gateway (toàn stage)', label: '↳ Còn lại (portal /api, dashboard /monitoring)', pick: otherStageRequests, format: formatNumber },
  { group: 'API Gateway (toàn stage)', label: '4xx', pick: (r) => r.apiGateway.error4xx, format: formatNumber },
  { group: 'API Gateway (toàn stage)', label: '5xx', pick: (r) => r.apiGateway.error5xx, format: formatNumber },
  { group: 'Replication', label: 'DynamoDB replication lag (gửi đi)', pick: (r) => r.dynamodbReplicationLatencyMs, format: formatMs },
  { group: 'Replication', label: 'S3 replication lag (gửi đi)', pick: (r) => r.s3ReplicationLatencyS, format: seconds },
];

function healthCheckLabel(r: RegionSnapshot): string {
  if (r.healthCheck.kind === 'missing') return 'Unknown';
  return r.healthCheck.value === 'healthy' ? 'Healthy' : 'Unhealthy';
}

function MetricTable({ label, regions, rows, top, bottom }: { label: string; regions: RegionSnapshot[]; rows: Row[]; top?: ReactNode; bottom?: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table aria-label={label} className="w-full min-w-[32rem] text-left text-sm">
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
          {top}
          {rows.map((row, i) => (
            <tr key={row.label} className="border-b border-line last:border-0">
              <td className="px-4 py-2.5 text-ink2">
                {(i === 0 || rows[i - 1].group !== row.group) && <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{row.group}</div>}
                {row.label}
              </td>
              {regions.map((r) => {
                const m = row.pick(r);
                return (
                  <td key={r.region} className="px-4 py-2.5 text-right align-bottom font-semibold tabular-nums text-ink">
                    {m ? <MetricText metric={m} format={row.format} /> : <OptionalMetric metric={m} format={row.format} />}
                  </td>
                );
              })}
            </tr>
          ))}
          {bottom}
        </tbody>
      </table>
    </div>
  );
}

function SectionHeading({ title, tag, children }: { title: string; tag: ReactNode; children: ReactNode }) {
  return (
    <div className="border-b border-line px-4 py-3">
      <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
        {title} {tag}
      </h2>
      <div className="mt-1 space-y-1 text-xs text-ink2">{children}</div>
    </div>
  );
}

function StatusRow({ label, regions, render }: { label: string; regions: RegionSnapshot[]; render: (r: RegionSnapshot) => ReactNode }) {
  return (
    <tr className="border-b border-line last:border-0">
      <td className="px-4 py-2.5 text-ink2">{label}</td>
      {regions.map((r) => (
        <td key={r.region} className="px-4 py-2.5 text-right">
          {render(r)}
        </td>
      ))}
    </tr>
  );
}

function TenantSection({ regions, mock }: { regions: RegionSnapshot[]; mock: boolean }) {
  const noTraffic = regions.every((r) => r.requests.kind === 'value' && r.requests.value === 0);
  return (
    <Card className="p-0">
      <SectionHeading title="Traffic của doanh nghiệp bạn" tag={<Tag tone="accent">Theo API key đang chọn</Tag>}>
        <p>Chỉ đếm request bạn gửi tới API của mình qua gateway (/proxy/…) bằng API key của doanh nghiệp đang đăng nhập. Không gồm health check, portal và dashboard.</p>
        {mock && <p>Ở chế độ dữ liệu mẫu, số liệu này là mô phỏng và không chia theo key.</p>}
        <p>N/A: backend chưa trả số liệu này hoặc không có mẫu nào. Không hiển thị 0 thay cho dữ liệu thiếu.</p>
      </SectionHeading>
      {noTraffic && (
        <p role="status" className="border-b border-line bg-raised px-4 py-2.5 text-sm text-ink">
          Chưa có request nào qua API key này trong khoảng thời gian đang xem. Key mới tạo sẽ hiện 0 cho tới khi bạn gọi API qua gateway.
        </p>
      )}
      <MetricTable label="Traffic của doanh nghiệp bạn" regions={regions} rows={TENANT_ROWS} />
      <p className="border-t border-line px-4 py-2.5 text-xs text-ink2">{COMPARISON_CAVEAT}</p>
    </Card>
  );
}

function SharedSection({ regions }: { regions: RegionSnapshot[] }) {
  return (
    <Card className="p-0">
      <SectionHeading title="Hạ tầng dùng chung toàn hệ thống" tag={<Tag>Không lọc theo API key</Tag>}>
        <p>
          <span className="font-semibold text-ink">Đây không phải lưu lượng của key bạn.</span> Đây là số liệu CloudWatch của cả nền tảng: Route 53 health check gọi GET /health khoảng mỗi 30
          giây từ nhiều điểm kiểm tra trên thế giới (thường chiếm phần lớn số request), cộng với portal, dashboard và request của mọi doanh nghiệp. Vì vậy các con số này vẫn tăng dù key của
          bạn chưa gửi request nào.
        </p>
        <p>Dùng để chứng minh hạ tầng hai Region đang chạy: Lambda, API Gateway, health check và replication.</p>
      </SectionHeading>
      <MetricTable
        label="Hạ tầng dùng chung toàn hệ thống"
        regions={regions}
        rows={SHARED_ROWS}
        top={
          <>
            <StatusRow label="Trạng thái hoạt động" regions={regions} render={(r) => <HealthBadge health={deriveRegionHealth(r)} />} />
            <StatusRow
              label="Route 53 health check"
              regions={regions}
              render={(r) => <HealthBadge health={r.healthCheck.kind === 'missing' ? 'unknown' : r.healthCheck.value === 'healthy' ? 'healthy' : 'down'} label={healthCheckLabel(r)} />}
            />
          </>
        }
        bottom={<StatusRow label="Tình trạng replication DynamoDB" regions={regions} render={(r) => <div><HealthBadge health={currentReplicationHealth(r.dynamodbReplicationLatencyMs, r.dynamodbReplicationObservedAt)} /><p className="mt-1 text-xs text-ink2">{r.dynamodbReplicationObservedAt != null ? `Mẫu gần nhất: ${formatDateTime(r.dynamodbReplicationObservedAt)}` : 'Chưa có thời điểm đo'}. Chỉ xác minh trạng thái khi có mẫu trong 1 giờ qua.</p></div>} />}
      />
    </Card>
  );
}

function RegionsContent({ snapshot, view, showShared }: { snapshot: MonitoringSnapshot; view: RegionView; showShared: boolean }) {
  const regions = view === 'compare' ? snapshot.regions : snapshot.regions.filter((r) => r.region === view);
  const shown = REGIONS.filter((r) => view === 'compare' || r.code === view);
  // Màu đi theo Region, không theo vị trí: lọc còn một Region thì Region đó vẫn giữ màu cũ.
  const series = shown.map((r) => ({ key: r.code, name: r.name, color: r.code === 'ap-southeast-1' ? 'var(--series-1)' : 'var(--series-2)' }));
  // Ô không có request → null (khoảng trống), không vẽ latency 0 ms hay error rate 0%.
  const rowsOf = (pick: (b: MonitoringSnapshot['series'][number]['regions'][RegionSnapshot['region']] | undefined) => number | null): ChartRow[] =>
    snapshot.series.map((p) => ({ t: p.t, ...Object.fromEntries(shown.map((r) => [r.code, pick(p.regions[r.code])])) }) as ChartRow);
  const partial = partialTimes(snapshot.series);
  const mockTag = snapshot.dataMode === 'mock' ? <Tag tone="warning">Mock data</Tag> : undefined;

  return (
    <div className="space-y-4">
      <TenantSection regions={regions} mock={snapshot.dataMode === 'mock'} />
      <div className="grid gap-4 xl:grid-cols-2">
        <TimeChart
          kind="line"
          title="Latency p95 (traffic của bạn)"
          subtitle="p95 trong từng ô thời gian. Ô không có request để trống."
          rows={rowsOf((b) => latencyPoint(b, 'p95'))}
          series={series}
          range={snapshot.range}
          format={formatMs}
          badge={mockTag}
          partial={partial}
        />
        <TimeChart
          kind="line"
          title="Error rate (traffic của bạn)"
          subtitle="Tỷ lệ request trả 4xx hoặc 5xx trong mỗi ô thời gian."
          rows={rowsOf(errorRatePoint)}
          series={series}
          range={snapshot.range}
          format={formatPct}
          badge={mockTag}
          partial={partial}
        />
      </div>
      {showShared ? (
        <SharedSection regions={regions} />
      ) : (
        <p className="text-sm text-ink2">Số liệu hạ tầng dùng chung toàn hệ thống (Lambda, API Gateway, replication) chỉ hiển thị cho tài khoản quản trị.</p>
      )}
    </div>
  );
}

// Chỉ admin của portal mới xem phần hạ tầng dùng chung; dữ liệu mẫu (không kết nối AWS) thì hiện cho mọi người.
function useIsAdmin(): boolean {
  const provider = useProvider();
  const token = readToken();
  const me = useQuery({
    queryKey: ['portal', token, 'me'], enabled: provider.id === 'http' && !!token, retry: false,
    queryFn: ({ signal }) => portalCall<{ role?: string }>('me', token, 'GET', undefined, signal),
  });
  return provider.id !== 'http' || me.data?.role === 'admin';
}

export function RegionsPage() {
  const query = useSnapshot();
  const showShared = useIsAdmin();
  const { settings, update } = useSettings();
  // Bộ lọc Region dùng chung với các trang khác (tham số region của báo cáo); chưa lọc thì theo Region mặc định trong Settings.
  const [view, setViewState] = useState<RegionView>(settings.region !== 'all' ? settings.region : settings.defaultRegion);
  const setView = (v: RegionView) => {
    setViewState(v);
    update({ region: v === 'compare' ? 'all' : v });
  };
  const options: { value: RegionView; label: string }[] = [{ value: 'compare', label: 'So sánh' }, ...REGIONS.map((r) => ({ value: r.code, label: r.name }))];

  return (
    <>
      <PageHeader
        title="Multi-Region Monitoring"
        description={showShared
          ? 'So sánh Singapore với Tokyo. Phần trên là traffic của doanh nghiệp bạn theo API key đang chọn; phần dưới là hạ tầng dùng chung toàn hệ thống, không phải lưu lượng của key bạn. Trạng thái chỉ hạ khi health check lỗi hoặc gateway lỗi, không vì backend chậm.'
          : 'So sánh Singapore với Tokyo theo traffic của doanh nghiệp bạn, lọc theo API key đang chọn.'}
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
      <QueryBoundary query={query}>{(snapshot) => <RegionsContent snapshot={snapshot} view={view} showShared={showShared} />}</QueryBoundary>
    </>
  );
}
