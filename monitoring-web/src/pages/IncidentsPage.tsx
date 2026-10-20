import { ArrowLeftRight, ChevronDown, FlaskConical, type LucideIcon, Siren } from 'lucide-react';
import { useState } from 'react';
import { useIncidents } from '../app/data';
import { Card, EmptyState, PageHeader, QueryBoundary, Tag } from '../components/ui';
import { formatDateTime, formatDuration } from '../domain/format';
import { type EventKind, type EventOrigin, type IncidentEvent, regionName } from '../domain/types';

const ORIGINS: { value: EventOrigin; label: string; tone: 'warning' | 'accent' | 'neutral'; explain: string; empty: string }[] = [
  {
    value: 'simulated',
    label: 'Simulated',
    tone: 'warning',
    explain: 'Sự kiện giả lập do dashboard sinh ra để trình diễn.',
    empty: 'Không có sự kiện thuộc nguồn này.',
  },
  {
    value: 'manual_test',
    label: 'Manual test',
    tone: 'accent',
    explain: 'Kết quả do nhóm tự đo khi kiểm thử failover.',
    empty: 'Chưa có kết quả kiểm thử thủ công nào được ghi nhận. Kết quả sẽ đến từ backend sau khi nhóm chạy bài test failover.',
  },
  {
    value: 'aws',
    label: 'AWS',
    tone: 'neutral',
    explain: 'Sự kiện thu thập từ AWS (CloudWatch alarm, Route 53 health check).',
    empty: 'Chưa có sự kiện nào thu thập từ AWS vì các nguồn AWS chưa được kết nối.',
  },
];

const KINDS: Record<EventKind, { label: string; icon: LucideIcon }> = {
  incident: { label: 'Sự cố', icon: Siren },
  traffic_shift: { label: 'Chuyển hướng traffic', icon: ArrowLeftRight },
  failover_test: { label: 'Kiểm thử failover', icon: FlaskConical },
};

function EventRow({ event }: { event: IncidentEvent }) {
  const [open, setOpen] = useState(false);
  const origin = ORIGINS.find((o) => o.value === event.origin)!;
  const { label, icon: Icon } = KINDS[event.kind];

  return (
    <li className="border-b border-line last:border-0">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-raised">
        <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-ink2" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-ink">{event.title}</span>
            <Tag tone={origin.tone}>{origin.label}</Tag>
          </span>
          <span className="mt-1 block text-xs text-ink2">
            {label} · {event.region === 'global' ? 'Toàn cục' : `${regionName(event.region)} (${event.region})`} · bắt đầu {formatDateTime(event.startedAt)}
          </span>
        </span>
        <ChevronDown aria-hidden className={`mt-0.5 size-4 shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="space-y-3 px-4 pb-4 pl-11 text-sm">
          <p className="text-ink2">{event.description}</p>
          <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
            <div>
              <dt className="text-ink2">Bắt đầu</dt>
              <dd className="font-medium text-ink">{formatDateTime(event.startedAt)}</dd>
            </div>
            <div>
              <dt className="text-ink2">Kết thúc</dt>
              <dd className="font-medium text-ink">{event.endedAt ? formatDateTime(event.endedAt) : 'Không ghi nhận'}</dd>
            </div>
            <div>
              <dt className="text-ink2">Thời gian phục hồi</dt>
              <dd className="font-medium text-ink">
                {event.recoverySeconds === null ? 'Chưa đo' : formatDuration(event.recoverySeconds)}
                {event.recoverySeconds !== null && event.origin === 'simulated' && <span className="font-normal text-ink2"> (giá trị mô phỏng)</span>}
              </dd>
            </div>
          </dl>
          <div>
            <div className="text-xs font-medium text-ink2">Bằng chứng và log liên quan</div>
            {event.evidence.length === 0 ? (
              <p className="mt-1 text-xs text-ink2">Chưa đính kèm bằng chứng.</p>
            ) : (
              <ul className="mt-1 space-y-1 text-xs">
                {event.evidence.map((item) => (
                  <li key={item.label} className="rounded border border-line px-2 py-1.5">
                    <span className="font-semibold text-ink">{item.label}:</span> <span className="text-ink2">{item.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function IncidentList({ events }: { events: IncidentEvent[] }) {
  const [origin, setOrigin] = useState<EventOrigin | 'all'>('all');
  const sorted = [...events].sort((a, b) => b.startedAt - a.startedAt);
  const shown = origin === 'all' ? sorted : sorted.filter((e) => e.origin === origin);
  const active = ORIGINS.find((o) => o.value === origin);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        {ORIGINS.map((o) => (
          <Card key={o.value}>
            <div className="flex items-center justify-between gap-2">
              <Tag tone={o.tone}>{o.label}</Tag>
              <span className="text-xl font-semibold text-ink">{events.filter((e) => e.origin === o.value).length}</span>
            </div>
            <p className="mt-2 text-xs text-ink2">{o.explain}</p>
          </Card>
        ))}
      </div>

      <div role="group" aria-label="Lọc theo nguồn gốc" className="inline-flex flex-wrap rounded-md border border-line bg-surface p-0.5">
        {[{ value: 'all' as const, label: 'Tất cả' }, ...ORIGINS].map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={origin === o.value}
            onClick={() => setOrigin(o.value)}
            className={`rounded px-3 py-1.5 text-sm ${origin === o.value ? 'bg-raised font-semibold text-ink' : 'text-ink2 hover:text-ink'}`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyState title="Không có sự kiện">{active ? active.empty : 'Chưa có sự kiện nào từ bất kỳ nguồn nào.'}</EmptyState>
      ) : (
        <Card className="p-0">
          <ul>
            {shown.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </ul>
        </Card>
      )}

      <p className="text-xs text-ink2">
        Chỉ sự kiện gắn nhãn AWS hoặc Manual test mới là bằng chứng về hành vi thật của hệ thống. Sự kiện Simulated không chứng minh Route 53 đã failover.
      </p>
    </div>
  );
}

export function IncidentsPage() {
  const query = useIncidents();
  return (
    <>
      <PageHeader title="Failover & Incidents" description="Lịch sử sự cố, sự kiện chuyển hướng traffic và kết quả kiểm thử failover." />
      <QueryBoundary query={query}>{(events) => <IncidentList events={events} />}</QueryBoundary>
    </>
  );
}
