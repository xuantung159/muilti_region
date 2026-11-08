import { AlertTriangle, CheckCircle2, CircleHelp, Inbox, type LucideIcon, RefreshCw, TriangleAlert, XCircle } from 'lucide-react';
import type { ReactNode, SelectHTMLAttributes } from 'react';
import { MISSING_LABEL } from '../domain/format';
import type { Health } from '../domain/status';
import type { Metric } from '../domain/types';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-surface p-5 shadow-sm ${className}`}>{children}</section>;
}

export function PageHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        <p className="mt-1 text-sm text-ink2">{description}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const HEALTH: Record<Health, { label: string; icon: LucideIcon; color: string }> = {
  healthy: { label: 'Healthy', icon: CheckCircle2, color: 'text-good' },
  degraded: { label: 'Degraded', icon: TriangleAlert, color: 'text-warning' },
  down: { label: 'Down', icon: XCircle, color: 'text-critical' },
  unknown: { label: 'Unknown', icon: CircleHelp, color: 'text-muted' },
};

// Trạng thái luôn gồm biểu tượng + nhãn chữ; màu chỉ là tín hiệu phụ.
export function HealthBadge({ health, label }: { health: Health; label?: string }) {
  const { icon: Icon, color, label: fallback } = HEALTH[health];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-surface px-2 py-0.5 text-xs font-medium text-ink">
      <Icon aria-hidden className={`size-3.5 ${color}`} />
      {label ?? fallback}
    </span>
  );
}

export function Tag({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'warning' | 'accent' | 'critical' }) {
  const tones = {
    neutral: 'border-line text-ink2',
    warning: 'border-warning bg-warning/10 text-ink',
    accent: 'border-accent bg-accent/10 text-ink',
    critical: 'border-critical bg-critical/10 text-ink',
  };
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${tones[tone]}`}>{children}</span>;
}

// Hiển thị một metric: có giá trị thì định dạng, không có thì nêu rõ lý do thay vì in số 0.
export function MetricText({ metric, format }: { metric: Metric; format: (n: number) => string }) {
  if (metric.kind === 'value') return <>{format(metric.value)}</>;
  return <span className="text-sm font-normal italic text-muted">{MISSING_LABEL[metric.reason]}</span>;
}

export function KpiCard({ label, metric, format, hint }: { label: string; metric: Metric; format: (n: number) => string; hint?: string }) {
  return (
    <Card>
      <div className="text-xs font-medium text-ink2">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-ink">
        <MetricText metric={metric} format={format} />
      </div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </Card>
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  const { label, className = '', children, ...rest } = props;
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-ink2">
      {label}
      <select {...rest} className={`h-9 rounded-md border border-line bg-surface px-2 text-sm font-normal text-ink ${className}`}>
        {children}
      </select>
    </label>
  );
}

export function Button({ children, onClick, icon: Icon, label }: { children?: ReactNode; onClick: () => void; icon?: LucideIcon; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-raised"
    >
      {Icon && <Icon aria-hidden className="size-4" />}
      {children}
    </button>
  );
}

export function LoadingState({ label = 'Đang tải dữ liệu…' }: { label?: string }) {
  return (
    <div role="status" className="space-y-3">
      <span className="sr-only">{label}</span>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-raised" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-xl bg-raised" />
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <Card className="flex flex-col items-start gap-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-ink">
        <AlertTriangle aria-hidden className="size-4 text-critical" />
        Không tải được dữ liệu
      </div>
      <p className="text-sm text-ink2">{error instanceof Error ? error.message : 'Lỗi không xác định.'}</p>
      <p className="text-sm text-ink2">Dashboard không hiển thị số liệu cũ hay số liệu thay thế khi nguồn dữ liệu lỗi.</p>
      <Button onClick={onRetry} icon={RefreshCw}>
        Thử lại
      </Button>
    </Card>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line bg-surface px-4 py-10 text-center">
      <Inbox aria-hidden className="size-6 text-muted" />
      <div className="text-sm font-semibold text-ink">{title}</div>
      {children && <div className="max-w-md text-sm text-ink2">{children}</div>}
    </div>
  );
}

// Bọc ba trạng thái tải / lỗi / có dữ liệu cho một truy vấn.
export function QueryBoundary<T>({
  query,
  children,
}: {
  query: { data: T | undefined; isPending: boolean; error: unknown; refetch: () => unknown };
  children: (data: T) => ReactNode;
}) {
  if (query.data !== undefined && !query.error) return <>{children(query.data)}</>;
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <LoadingState />;
}
