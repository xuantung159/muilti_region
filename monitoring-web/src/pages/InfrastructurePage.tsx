import { useProvider, useSnapshot } from '../app/data';
import { Card, HealthBadge, MetricText, PageHeader } from '../components/ui';
import { DEPLOYMENT, type DeployScope, type DeployedResource, ENDPOINTS, VERIFIED_AT } from '../data/deployment';
import { formatNumber } from '../domain/format';
import { REGIONS, type RegionCode, type RegionSnapshot } from '../domain/types';

function ResourceList({ items }: { items: DeployedResource[] }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((r) => (
        <li key={r.service} className="py-2.5">
          <div className="text-sm font-semibold text-ink">{r.service}</div>
          <div className="break-words text-xs text-ink2">{r.resource}</div>
          {r.note && <div className="mt-0.5 text-xs text-muted">{r.note}</div>}
        </li>
      ))}
    </ul>
  );
}

// Trạng thái sống của Region lấy từ snapshot; thiếu backend thì hiện lý do thiếu, không suy đoán.
function LiveRegion({ snapshot }: { snapshot: RegionSnapshot | undefined }) {
  if (!snapshot) return <span className="text-xs italic text-muted">Đang tải trạng thái…</span>;
  const hc = snapshot.healthCheck;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-ink2">
      {hc.kind === 'value' ? (
        <HealthBadge health={hc.value === 'healthy' ? 'healthy' : 'down'} label={hc.value === 'healthy' ? 'Health check OK' : 'Health check lỗi'} />
      ) : (
        <HealthBadge health="unknown" label="Health check: chưa có dữ liệu" />
      )}
      <span>
        Request: <MetricText metric={snapshot.requests} format={formatNumber} />
      </span>
    </div>
  );
}

const SCOPE_TITLE: Record<DeployScope, string> = {
  global: 'Toàn cục (us-east-1)',
  'ap-southeast-1': 'Singapore (ap-southeast-1)',
  'ap-northeast-1': 'Tokyo (ap-northeast-1)',
};

export function InfrastructurePage() {
  const provider = useProvider();
  const snapshot = useSnapshot();
  const regionSnap = (code: RegionCode) => snapshot.data?.regions.find((r) => r.region === code);

  return (
    <>
      <PageHeader
        title="Hạ tầng triển khai"
        description={`Tài nguyên AWS đang chạy theo kiến trúc hai Region, đối chiếu AWS Console ngày ${VERIFIED_AT}.`}
      />
      <div className="space-y-4">
        <Card>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <div className="text-xs font-medium text-ink2">Portal và giám sát</div>
              <a className="break-all font-mono text-ink underline" href={ENDPOINTS.app}>
                {ENDPOINTS.app}
              </a>
            </div>
            <div>
              <div className="text-xs font-medium text-ink2">API (Route 53 latency)</div>
              <span className="break-all font-mono text-ink">{ENDPOINTS.api}</span>
            </div>
          </div>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold text-ink">{SCOPE_TITLE.global}</h2>
          <p className="text-xs text-ink2">Người dùng → Route 53 (latency + health check) → API Gateway Region gần nhất; portal đi qua CloudFront.</p>
          <ResourceList items={DEPLOYMENT.global} />
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          {REGIONS.map(({ code }) => (
            <Card key={code}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-ink">{SCOPE_TITLE[code]}</h2>
                  <p className="break-all font-mono text-xs text-ink2">{ENDPOINTS.regional[code]}</p>
                </div>
                {provider.id === 'mock' && <span className="text-xs text-muted">Trạng thái sống: dữ liệu mẫu</span>}
              </div>
              <div className="mt-2">
                {snapshot.error ? <span className="text-xs text-critical">Không tải được trạng thái sống</span> : <LiveRegion snapshot={regionSnap(code)} />}
              </div>
              <ResourceList items={DEPLOYMENT[code]} />
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}
