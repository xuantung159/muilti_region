import { useRoutes, useProvider } from '../app/data';
import { countryLabel, REGION_COLOR, REQUEST_COLOR, RoutingMap } from '../components/RoutingMap';
import { KeySelect, RangeSelect } from '../components/Toolbar';
import { Card, EmptyState, PageHeader, QueryBoundary, Tag } from '../components/ui';
import { formatDateTime, formatNumber } from '../domain/format';
import { regionName, REGIONS, type RouteStat } from '../domain/types';

function RegionTotals({ routes }: { routes: RouteStat[] }) {
  const total = routes.reduce((s, r) => s + r.requests, 0);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {REGIONS.map(({ code }) => {
        const mine = routes.filter((r) => r.servedRegion === code);
        const requests = mine.reduce((s, r) => s + r.requests, 0);
        return (
          <Card key={code}>
            <div className="flex items-center gap-2">
              <span className="inline-block size-3 rounded-full" style={{ background: REGION_COLOR }} />
              <p className="font-semibold text-ink">{regionName(code)}</p>
              <span className="text-xs text-ink2">{code}</span>
            </div>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-ink">{formatNumber(requests)} <span className="text-sm font-normal text-ink2">request</span></p>
            <p className="mt-1 text-sm text-ink2">
              {total ? `${Math.round((requests / total) * 100)}% tổng traffic` : 'Chưa có traffic'}
              {mine.length > 0 && ` · từ ${mine.map((r) => countryLabel(r.country)).join(', ')}`}
            </p>
          </Card>
        );
      })}
    </div>
  );
}

function RouteTable({ routes }: { routes: RouteStat[] }) {
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full min-w-[36rem] text-left text-sm">
        <thead className="border-b border-line text-xs text-ink2">
          <tr>
            <th className="px-4 py-3 font-medium">Request đến từ</th>
            <th className="px-4 py-3 font-medium">Được chuyển tới Region</th>
            <th className="px-4 py-3 text-right font-medium">Số request</th>
            <th className="px-4 py-3 text-right font-medium">Lần cuối</th>
          </tr>
        </thead>
        <tbody>
          {routes.map((r) => (
            <tr key={`${r.country}-${r.servedRegion}`} className="border-b border-line last:border-0">
              <td className="px-4 py-2.5 text-ink">
                <span className="mr-2 inline-block size-2.5 rounded-sm align-middle" style={{ background: REQUEST_COLOR }} />
                {countryLabel(r.country)} <span className="text-xs text-ink2">({r.country})</span>
              </td>
              <td className="px-4 py-2.5 text-ink">
                <span className="mr-2 inline-block size-2.5 rounded-full align-middle" style={{ background: REGION_COLOR }} />
                {regionName(r.servedRegion)} <span className="text-xs text-ink2">({r.servedRegion})</span>
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-ink">{formatNumber(r.requests)}</td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-ink2">{formatDateTime(r.lastSeen)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export function RoutingPage() {
  const query = useRoutes();
  const provider = useProvider();
  return (
    <>
      <PageHeader
        title="Định tuyến theo vị trí"
        description="Request tới API doanh nghiệp (/proxy/…) đến từ quốc gia nào và được Route 53 (latency-based) chuyển tới Region nào. Quốc gia suy ra từ IP nguồn bằng dữ liệu GeoLite2 offline; hệ thống không lưu IP."
        actions={provider.id === 'mock' ? <Tag tone="warning">Dữ liệu minh họa</Tag> : undefined}
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <KeySelect />
        <RangeSelect />
        <p className="text-xs text-ink2">Chỉ tính request của doanh nghiệp bạn (theo API key đang chọn), ghi ngay khi proxy trả lời.</p>
      </div>
      <QueryBoundary query={query}>
        {(routes) => (
          <div className="space-y-4">
            <Card>
              <RoutingMap routes={routes} />
            </Card>
            {routes.length === 0 ? (
              <EmptyState title="Chưa có request nào trong khoảng thời gian này">
                Gọi API qua gateway, ví dụ từ CloudShell us-east-1 (Mỹ) và từ máy ở Việt Nam, rồi làm mới sau 1–3 phút. Health check của Route 53 không được tính.
              </EmptyState>
            ) : (
              <>
                <RegionTotals routes={routes} />
                <RouteTable routes={routes} />
              </>
            )}
            <p className="text-xs text-muted">
              Dữ liệu quốc gia: GeoLite2 của MaxMind (https://www.maxmind.com). Bản đồ: Natural Earth qua world-atlas.
            </p>
          </div>
        )}
      </QueryBoundary>
    </>
  );
}
