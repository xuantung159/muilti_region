import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useEndpoints, useProvider } from '../app/data';
import { RangeSelect } from '../components/Toolbar';
import { Card, EmptyState, HealthBadge, PageHeader, QueryBoundary, Select, Tag } from '../components/ui';
import { formatDateTime, formatMs, formatNumber, formatPct } from '../domain/format';
import { deriveEndpointHealth, type Health } from '../domain/status';
import { type EndpointStat, type HttpMethod, type RegionCode, regionName, REGIONS } from '../domain/types';

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE'];
const HEALTHS: { value: Health; label: string }[] = [
  { value: 'healthy', label: 'Healthy' },
  { value: 'degraded', label: 'Degraded' },
  { value: 'down', label: 'Down' },
  { value: 'unknown', label: 'Unknown' },
];

function EndpointTable({ endpoints }: { endpoints: EndpointStat[] }) {
  const [search, setSearch] = useState('');
  const [region, setRegion] = useState<RegionCode | 'all'>('all');
  const [method, setMethod] = useState<HttpMethod | 'all'>('all');
  const [health, setHealth] = useState<Health | 'all'>('all');

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return endpoints
      .map((e) => ({ ...e, health: deriveEndpointHealth(e) }))
      .filter((e) => (!needle || e.path.toLowerCase().includes(needle)) && (region === 'all' || e.region === region) && (method === 'all' || e.method === method) && (health === 'all' || e.health === health));
  }, [endpoints, search, region, method, health]);

  if (endpoints.length === 0)
    return <EmptyState title="Chưa có dữ liệu endpoint">Nguồn dữ liệu chưa trả về endpoint nào. Kiểm tra trang Data Sources để biết nguồn nào chưa kết nối.</EmptyState>;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs font-medium text-ink2">
          Tìm endpoint
          <span className="relative">
            <Search aria-hidden className="absolute left-2.5 top-2.5 size-4 text-muted" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="/orders"
              className="h-9 w-full rounded-md border border-line bg-surface pl-8 pr-2 text-sm font-normal text-ink placeholder:text-muted"
            />
          </span>
        </label>
        <Select label="Region" value={region} onChange={(e) => setRegion(e.target.value as RegionCode | 'all')}>
          <option value="all">Tất cả</option>
          {REGIONS.map((r) => (
            <option key={r.code} value={r.code}>
              {r.name}
            </option>
          ))}
        </Select>
        <Select label="Method" value={method} onChange={(e) => setMethod(e.target.value as HttpMethod | 'all')}>
          <option value="all">Tất cả</option>
          {METHODS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </Select>
        <Select label="Trạng thái" value={health} onChange={(e) => setHealth(e.target.value as Health | 'all')}>
          <option value="all">Tất cả</option>
          {HEALTHS.map((h) => (
            <option key={h.value} value={h.value}>
              {h.label}
            </option>
          ))}
        </Select>
        <RangeSelect />
      </div>

      <p className="mb-2 text-xs text-ink2" aria-live="polite">
        Hiển thị {rows.length} trên {endpoints.length} dòng.
      </p>

      {rows.length === 0 ? (
        <EmptyState title="Không có endpoint nào khớp bộ lọc">Thử bỏ bớt điều kiện lọc hoặc xóa từ khóa tìm kiếm.</EmptyState>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[56rem] text-left text-sm">
            <thead className="border-b border-line text-xs text-ink2">
              <tr>
                {['Method', 'Endpoint', 'Region', 'Status'].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">
                    {h}
                  </th>
                ))}
                {['Request count', 'Success rate', 'Error rate', 'Latency', 'Last updated'].map((h) => (
                  <th key={h} className="px-4 py-3 text-right font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={`${e.method} ${e.path} ${e.region}`} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5 font-mono text-xs font-semibold text-ink">{e.method}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-ink">{e.path}</td>
                  <td className="px-4 py-2.5 text-ink2">{regionName(e.region)}</td>
                  <td className="px-4 py-2.5">
                    <HealthBadge health={e.health} />
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink">{formatNumber(e.requests)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink">{formatPct(e.successRatePct)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink">{formatPct(e.errorRatePct)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink">{formatMs(e.latencyAvgMs)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-ink2">{formatDateTime(e.lastUpdated)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

export function ApisPage() {
  const query = useEndpoints();
  const provider = useProvider();
  return (
    <>
      <PageHeader title="API Monitoring" description="Tình trạng từng endpoint theo Region." actions={provider.id === 'mock' ? <Tag tone="warning">Endpoint minh họa</Tag> : undefined} />
      {provider.id === 'mock' && (
        <p className="mb-4 text-sm text-ink2">Danh sách endpoint dưới đây là minh họa cho đến khi cấu hình API thật được xác nhận. Trạng thái suy ra từ error rate: từ 1% là Degraded, từ 5% là Down.</p>
      )}
      <QueryBoundary query={query}>{(endpoints) => <EndpointTable endpoints={endpoints} />}</QueryBoundary>
    </>
  );
}
