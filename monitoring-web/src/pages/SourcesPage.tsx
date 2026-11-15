import { CheckCircle2, FlaskConical, type LucideIcon, Unplug, XCircle } from 'lucide-react';
import { useSources } from '../app/data';
import { Card, PageHeader, QueryBoundary } from '../components/ui';
import { formatDateTime } from '../domain/format';
import type { DataSource, SourceStatus } from '../domain/types';

const STATUS: Record<SourceStatus, { label: string; icon: LucideIcon; color: string }> = {
  mock: { label: 'Mock', icon: FlaskConical, color: 'text-warning' },
  not_connected: { label: 'Not connected', icon: Unplug, color: 'text-muted' },
  connected: { label: 'Connected', icon: CheckCircle2, color: 'text-good' },
  error: { label: 'Error', icon: XCircle, color: 'text-critical' },
};

const guides = import.meta.glob('../../docs/integration/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

function SourceCard({ source }: { source: DataSource }) {
  const { label, icon: Icon, color } = STATUS[source.status];
  const guideName = source.guide.split('/').pop();
  const guide = guides[`../../docs/integration/${guideName}`];
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-ink">{source.service}</h2>
          <p className="text-xs text-ink2">{source.regions}</p>
        </div>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-line px-2 py-0.5 text-xs font-medium text-ink">
          <Icon aria-hidden className={`size-3.5 ${color}`} />
          {label}
        </span>
      </div>
      <div>
        <div className="text-xs font-medium text-ink2">Dữ liệu hỗ trợ</div>
        <ul className="mt-1 flex flex-wrap gap-1.5">
          {source.metrics.map((m) => (
            <li key={m} className="rounded bg-raised px-1.5 py-0.5 text-xs text-ink">
              {m}
            </li>
          ))}
        </ul>
      </div>
      <dl className="grid gap-2 text-xs">
        <div>
          <dt className="text-ink2">Kiểm tra kết nối gần nhất</dt>
          <dd className="font-medium text-ink">{source.lastSync ? formatDateTime(source.lastSync) : 'Chưa từng đồng bộ'}</dd>
        </div>
        <div>
          <dt className="text-ink2">Chi tiết kết nối và dữ liệu</dt>
          <dd className="text-ink">{source.note}</dd>
        </div>
        <div>
          <dt className="text-ink2">Hướng dẫn tích hợp</dt>
          <dd className="text-ink">{guide ? (
            <details className="mt-1">
              <summary className="cursor-pointer font-medium text-accent">Mở hướng dẫn {source.service}</summary>
              <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-raised p-3 font-mono text-xs">{guide}</pre>
            </details>
          ) : <span>Chưa có tài liệu tích hợp cho nguồn này.</span>}</dd>
        </div>
      </dl>
    </Card>
  );
}

export function SourcesPage() {
  const query = useSources();
  return (
    <>
      <PageHeader title="Data Sources & Integration Status" description="Nguồn dữ liệu của dashboard và tình trạng tích hợp với từng dịch vụ AWS." />
      <QueryBoundary query={query}>
        {(sources) => {
          const connected = sources.filter((s) => s.status === 'connected').length;
          const aws = sources.filter((s) => s.status !== 'mock').length;
          return (
            <div className="space-y-4">
              <p className="text-sm text-ink2">
                <span className="font-semibold text-ink">
                  {connected} trên {aws}
                </span>{' '}
                nguồn AWS đã kết nối. Connected xác nhận truy vấn thành công, không có nghĩa luôn có metric mới. {connected === 0 && ' Chưa có số liệu AWS thật nào được hiển thị trên dashboard.'}
              </p>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {sources.map((s) => (
                  <SourceCard key={s.id} source={s} />
                ))}
              </div>
            </div>
          );
        }}
      </QueryBoundary>
    </>
  );
}
